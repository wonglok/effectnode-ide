import { useProjectStore } from '@/store/projects';
import { useUiStore } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';

/** Flush pending edits and persist the project (prompting for a name if needed). */
export function saveProject(): void {
  useWorkspaceStore.getState().flush();
  const projects = useProjectStore.getState();

  if (projects.currentId) {
    void projects.save();
    return;
  }

  useUiStore.getState().openPrompt({
    title: 'Save project',
    label: 'Project name',
    initialValue: projects.name,
    confirmLabel: 'Save to Nitro',
    onConfirm: (value) => {
      void useProjectStore.getState().save(value);
    },
  });
}
