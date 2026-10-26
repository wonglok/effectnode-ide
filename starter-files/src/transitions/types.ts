import type { Color, Node, PassNode, UniformNode } from "three/webgpu";

/** The color texture a chapter's PassNode exposes to the compositor. */
export type TextureNode = ReturnType<PassNode["getTextureNode"]>;

/**
 * Everything a handoff shader needs from the compositor. Progress is already
 * eased by the pipeline; transitions just read it.
 */
export type TransitionContext = {
  fromTexture: TextureNode;
  toTexture: TextureNode;
  progress: UniformNode<"float", number>;
  accent: UniformNode<"color", Color>;
  /** Shared vignette + film-grain pass, applied last. */
  finish: (input: Node<"vec4">) => Node<"vec4">;
};

/** Builds the output node for one chapter-to-chapter handoff. */
export type Transition = (context: TransitionContext) => Node<"vec4">;
