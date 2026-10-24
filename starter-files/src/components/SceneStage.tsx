import { useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SECTIONS } from "../sections/registry.ts";
import { buildSoftRoom } from "../sections/soft-room/index.ts";
import { buildForceShield } from "../sections/force-shield/index.ts";
import { buildKinetic } from "../sections/kinetic/index.ts";
import { buildFlow } from "../sections/flow-shield/index.ts";
import { buildLiveEnv } from "../sections/live-env/index.ts";
import { buildAlpha } from "../sections/alpha6/index.ts";
import type { ChapterWorld, Pointer } from "../sections/shared.ts";
import { SectionRenderPipeline } from "../lib/render-pipeline.ts";
import { getSectionPhaseAt } from "../lib/scroll-phases.ts";
import { useScrollerStore } from "../store/useScrollerStore.ts";

const BUILDERS = [
  buildSoftRoom,
  buildForceShield,
  buildKinetic,
  buildFlow,
  buildLiveEnv,
  buildAlpha,
];

export function SceneStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const markReady = () => {
      const store = useScrollerStore.getState();
      store.setPreloadProgress(1);
      store.setBootPhase("ready");
    };

    if (!("gpu" in navigator)) {
      markReady();
      setFailed(true);
      return;
    }

    const worlds: ChapterWorld[] = SECTIONS.map((section, index) =>
      BUILDERS[index % BUILDERS.length](section.accent),
    );

    // Every chapter owns a scene and a camera. The compositor renders only the
    // active one — or the two chapters mid-handoff — into its own pass texture.
    const scenes = SECTIONS.map((section, index) => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(section.surface);
      scene.add(worlds[index].group);
      return scene;
    });

    const cameras = SECTIONS.map(() => {
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
      camera.position.set(0, 0, 9.6);
      return camera;
    });

    const passes = scenes.map((scene, index) => pass(scene, cameras[index]));

    const pointer: Pointer = { x: 0, y: 0 };
    const target: Pointer = { x: 0, y: 0 };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      target.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const state = useScrollerStore.getState();
      const index =
        state.isTransitioning && state.transitionProgress > 0.5
          ? state.toIndex
          : state.fromIndex;
      const world = worlds[index];
      const camera = cameras[index];
      if (!world || !camera) return;

      raycaster.setFromCamera(pointerNdc, camera);
      const hit = raycaster.intersectObject(world.group, true)[0];
      if (hit) world.onPointerDown?.(hit.point);
    };
    canvas.addEventListener("pointerdown", onPointerDown);

    let width = 1;
    let height = 1;
    let frame = 0;
    let renderer: THREE.WebGPURenderer | null = null;
    let pipeline: SectionRenderPipeline | null = null;
    let envTarget: THREE.RenderTarget | null = null;
    let roomEnv: RoomEnvironment | null = null;
    let disposed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const aspect = width / height;
      cameras.forEach((camera) => {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      });
      worlds.forEach((world) => world.resize?.(aspect));
      renderer?.setSize(width, height, false);
    };

    resize();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", resize);

    const start = async () => {
      try {
        renderer = new THREE.WebGPURenderer({
          canvas,
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.setSize(width, height, false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.06;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.VSMShadowMap;
        await renderer.init();
      } catch (error) {
        console.warn("WebGPU unavailable, using the static stage:", error);
        if (!disposed) {
          markReady();
          setFailed(true);
        }
        return;
      }

      if (disposed || !renderer) return;

      // Prefilter a neutral room for the glass reflections.
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        roomEnv = new RoomEnvironment();
        envTarget = pmrem.fromScene(roomEnv, 0.04);
        pmrem.dispose();
        SECTIONS.forEach((section, index) => {
          if (section.id !== "kinetic") return;
          scenes[index].environment = envTarget!.texture;
          scenes[index].environmentIntensity = 0.9;
        });
      } catch (error) {
        console.warn("Glass environment unavailable:", error);
      }

      try {
        pipeline = new SectionRenderPipeline(renderer, passes);
        pipeline.prewarm();
      } catch (error) {
        console.warn(
          "Scene compositor unavailable, using the static stage:",
          error,
        );
        pipeline = null;
        if (!disposed) {
          markReady();
          setFailed(true);
        }
        return;
      }

      let startedAt = performance.now();
      let firstFrame = true;

      const render = (now: number) => {
        frame = window.requestAnimationFrame(render);
        const time = (now - startedAt) / 1000;

        pointer.x += (target.x - pointer.x) * 0.05;
        pointer.y += (target.y - pointer.y) * 0.05;

        const state = useScrollerStore.getState();

        for (let index = 0; index < worlds.length; index += 1) {
          const world = worlds[index];
          const phase = getSectionPhaseAt(index, state.scrollProgress);
          const involved = index === state.fromIndex || index === state.toIndex;

          // Phase drives the handoff: scenes drift away as they leave and
          // settle back to full presence in their hold window.
          world.group.scale.setScalar(0.965 + phase.activity * 0.035);
          world.group.position.y = (1 - phase.activity) * -0.22;

          if (involved) {
            world.update(time, pointer, phase);
          }

          const camera = cameras[index];
          const lift =
            phase.phase === "enter"
              ? 1 - phase.progress
              : phase.phase === "exit"
                ? phase.progress
                : 0;

          camera.position.x = pointer.x * 0.45;
          camera.position.y = -pointer.y * 0.32;
          camera.position.z =
            9.6 + Math.sin(time * 0.24 + index) * 0.12 + lift * 0.9;
          camera.lookAt(0, 0, 0);
        }

        pipeline!.update(
          {
            fromIndex: state.fromIndex,
            toIndex: state.toIndex,
            isTransitioning: state.isTransitioning,
            progress: state.transitionProgress,
          },
          time,
        );
        pipeline!.render();

        if (firstFrame) {
          firstFrame = false;
          markReady();
        }
      };

      startedAt = performance.now();
      frame = window.requestAnimationFrame(render);
    };

    void start();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);

      worlds.forEach((world) => {
        world.group.traverse((object) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose());
          } else {
            material?.dispose();
          }
        });
      });

      try {
        pipeline?.dispose();
        passes.forEach((node) => node.dispose());
      } catch {
        // The compositor may not have finished compiling its first frame.
      }
      pipeline = null;

      envTarget?.dispose();
      envTarget = null;
      roomEnv?.dispose();
      roomEnv = null;

      try {
        renderer?.dispose();
      } catch {
        // The renderer may still be initialising during a hot remount.
      }
      renderer = null;
    };
  }, []);

  return (
    <div className="ef-stage" aria-hidden="true">
      {failed ? (
        <div className="ef-stage-fallback" />
      ) : (
        <canvas ref={canvasRef} className="ef-stage-canvas" />
      )}
    </div>
  );
}
