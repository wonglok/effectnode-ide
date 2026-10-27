import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Clapperboard, LayoutTemplate } from 'lucide-react';
import {
  DEFAULT_STARTER_TEMPLATE,
  STARTER_TEMPLATES,
  type StarterTemplateId,
} from '@/lib/starter-project';
import { useProjectLibraryStore } from '@/store/library';
import { useUiStore } from '@/store/ui';
import { Modal } from './Dialogs';

const TEMPLATE_ICONS = {
  simple: LayoutTemplate,
  movie: Clapperboard,
};

export function NewProjectDialog() {
  const open = useUiStore((state) => state.newProjectOpen);
  const close = useUiStore((state) => state.closeNewProject);
  const createProject = useProjectLibraryStore((state) => state.createProject);
  const busy = useProjectLibraryStore((state) => state.busy);
  const [name, setName] = useState('untitled');
  const [template, setTemplate] = useState<StarterTemplateId>(
    DEFAULT_STARTER_TEMPLATE
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName('untitled');
    setTemplate(DEFAULT_STARTER_TEMPLATE);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const projectName = name.trim();
    if (!projectName || busy) return;
    close();
    void createProject(projectName, template);
  };

  return (
    <Modal
      title="New project"
      subtitle="Name the project and pick the starter it begins from."
      onClose={close}
      width={560}
      footer={
        <>
          <button className="ghost-button" onClick={close}>
            Cancel
          </button>
          <button
            className="solid-button small"
            onClick={() => submit()}
            disabled={!name.trim() || Boolean(busy)}
          >
            Create project
          </button>
        </>
      }
    >
      <form className="new-project-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Project name</span>
          <input
            ref={inputRef}
            className="field-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. landing-page-v2"
            spellCheck={false}
            maxLength={120}
            id="forge-new-project-name"
            name="project-name"
          />
        </label>

        <div className="field">
          <span className="field-label">Starter template</span>
          <div
            className="template-picker"
            role="radiogroup"
            aria-label="Starter template"
          >
            {STARTER_TEMPLATES.map((item) => {
              const Icon = TEMPLATE_ICONS[item.id];
              const selected = template === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`template-card ${selected ? 'is-selected' : ''}`}
                  onClick={() => setTemplate(item.id)}
                >
                  <span className="template-card-head">
                    <Icon size={15} className="template-card-icon" />
                    <span className="template-card-name">{item.label}</span>
                    {selected ? (
                      <span className="template-card-check">Selected</span>
                    ) : null}
                  </span>
                  <span className="template-card-copy">{item.description}</span>
                  <span className="template-card-meta">{item.meta}</span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="new-project-note">
          Files and public assets are copied into a new local project. The
          current project stays in the library.
        </p>
      </form>
    </Modal>
  );
}
