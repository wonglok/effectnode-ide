import { useUiStore } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { joinPath, normalizePath } from './paths';
import { runtime } from './runtime';

export interface ShellLine {
  kind: 'output' | 'error' | 'muted';
  text: string;
}

export interface ShellResult {
  lines: ShellLine[];
  cwd: string;
  clear?: boolean;
}

const HELP = `Forge shell — commands run against the virtual file system

  ls [path]            list a directory
  cd <path>            change directory
  pwd                  print the working directory
  cat <file...>        print file contents
  touch <file>         create an empty file
  mkdir <dir>          create a folder
  rm [-r] <path>       remove a file or folder
  mv <from> <to>       rename or move
  cp <from> <to>       copy a file
  echo <text> [> file] print text or write it to a file
  tree [dir]           print the directory tree
  open <file>          open a file in the editor
  clear                clear this terminal
  help                 show this message

The preview server is built in, so npm install is not needed for React apps.`;

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function resolveArg(arg: string, cwd: string): string {
  if (arg.startsWith('/')) return normalizePath(arg);
  return joinPath(cwd, arg);
}

function listDirectory(path: string): ShellLine[] {
  const entries = runtime.listDir(path);
  if (entries.length === 0) return [{ kind: 'muted', text: '(empty directory)' }];
  entries.sort((a, b) => {
    const aDir = runtime.isDirectory(joinPath(path, a));
    const bDir = runtime.isDirectory(joinPath(path, b));
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.localeCompare(b);
  });
  return entries.map((entry) => {
    const isDir = runtime.isDirectory(joinPath(path, entry));
    return { kind: 'output' as const, text: `${entry}${isDir ? '/' : ''}` };
  });
}

function printTree(root: string): ShellLine[] {
  const lines: ShellLine[] = [];
  const walk = (dir: string, prefix: string, depth: number) => {
    if (depth > 8 || lines.length > 300) return;
    const entries = runtime.listDir(dir);
    entries.sort((a, b) => {
      const aDir = runtime.isDirectory(joinPath(dir, a));
      const bDir = runtime.isDirectory(joinPath(dir, b));
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });
    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      const full = joinPath(dir, entry);
      const isDir = runtime.isDirectory(full);
      lines.push({ kind: 'output', text: `${prefix}${isLast ? '└── ' : '├── '}${entry}${isDir ? '/' : ''}` });
      if (isDir) walk(full, prefix + (isLast ? '    ' : '│   '), depth + 1);
    });
  };
  walk(root, '', 0);
  if (lines.length === 0) lines.push({ kind: 'muted', text: '(empty directory)' });
  return lines;
}

export async function runShellCommand(rawInput: string, cwd: string): Promise<ShellResult> {
  const input = rawInput.trim();
  const result: ShellResult = { lines: [], cwd };

  if (!input) return result;

  let redirectTo: string | null = null;
  let commandText = input;
  const redirectMatch = commandText.match(/(^|\s)>{1,2}\s*(\S+)\s*$/);
  if (redirectMatch) {
    redirectTo = resolveArg(redirectMatch[2], cwd);
    commandText = commandText.slice(0, redirectMatch.index).trim();
  }

  const tokens = tokenize(commandText);
  const command = tokens[0];
  const args = tokens.slice(1);

  const pushError = (text: string) => result.lines.push({ kind: 'error', text });

  switch (command) {
    case 'help':
      result.lines.push({ kind: 'output', text: HELP });
      break;

    case 'clear':
      result.clear = true;
      break;

    case 'pwd':
      result.lines.push({ kind: 'output', text: cwd });
      break;

    case 'ls': {
      const target = resolveArg(args[0] ?? '.', cwd);
      if (!runtime.exists(target)) {
        pushError(`ls: no such file or directory: ${target}`);
      } else if (!runtime.isDirectory(target)) {
        result.lines.push({ kind: 'output', text: target });
      } else {
        result.lines.push(...listDirectory(target));
      }
      break;
    }

    case 'cd': {
      const target = resolveArg(args[0] ?? '/', cwd);
      if (!runtime.exists(target)) pushError(`cd: no such directory: ${target}`);
      else if (!runtime.isDirectory(target)) pushError(`cd: not a directory: ${target}`);
      else result.cwd = target;
      break;
    }

    case 'cat': {
      if (args.length === 0) {
        pushError('cat: missing file operand');
        break;
      }
      for (const arg of args) {
        const target = resolveArg(arg, cwd);
        const content = runtime.readFile(target);
        if (content === null) pushError(`cat: cannot read ${target}`);
        else result.lines.push({ kind: 'output', text: content });
      }
      break;
    }

    case 'touch': {
      if (args.length === 0) {
        pushError('touch: missing file operand');
        break;
      }
      for (const arg of args) {
        const target = resolveArg(arg, cwd);
        if (!runtime.exists(target)) {
          runtime.createFile(target, '');
          useWorkspaceStore.getState().refresh();
          useWorkspaceStore.getState().syncBuffer(target);
          result.lines.push({ kind: 'muted', text: `created ${target}` });
        }
      }
      break;
    }

    case 'mkdir': {
      const dirs = args.filter((arg) => !arg.startsWith('-'));
      if (dirs.length === 0) {
        pushError('mkdir: missing directory operand');
        break;
      }
      for (const arg of dirs) {
        const target = resolveArg(arg, cwd);
        if (runtime.exists(target)) {
          pushError(`mkdir: already exists: ${target}`);
        } else {
          runtime.createFolder(target);
          useWorkspaceStore.getState().refresh();
          result.lines.push({ kind: 'muted', text: `created ${target}/` });
        }
      }
      break;
    }

    case 'rm': {
      const recursive = args.some((arg) => arg.startsWith('-') && arg.includes('r'));
      const targets = args.filter((arg) => !arg.startsWith('-'));
      if (targets.length === 0) {
        pushError('rm: missing operand');
        break;
      }
      for (const arg of targets) {
        const target = resolveArg(arg, cwd);
        if (!runtime.exists(target)) {
          pushError(`rm: no such file or directory: ${target}`);
          continue;
        }
        if (runtime.isDirectory(target) && !recursive) {
          pushError(`rm: ${target} is a directory (use -r)`);
          continue;
        }
        const ok = useWorkspaceStore.getState().deleteEntry(target);
        if (ok) result.lines.push({ kind: 'muted', text: `removed ${target}` });
      }
      break;
    }

    case 'mv': {
      if (args.length < 2) {
        pushError('mv: usage: mv <from> <to>');
        break;
      }
      const from = resolveArg(args[0], cwd);
      const to = resolveArg(args[1], cwd);
      const ok = useWorkspaceStore.getState().renameEntry(from, to);
      if (ok) result.lines.push({ kind: 'muted', text: `moved ${from} → ${to}` });
      else pushError(`mv: cannot move ${from}`);
      break;
    }

    case 'cp': {
      if (args.length < 2) {
        pushError('cp: usage: cp <from> <to>');
        break;
      }
      const from = resolveArg(args[0], cwd);
      const to = resolveArg(args[1], cwd);
      if (runtime.isDirectory(from)) {
        pushError('cp: directory copy is not supported');
        break;
      }
      const content = runtime.readFile(from);
      if (content === null) {
        pushError(`cp: cannot read ${from}`);
        break;
      }
      runtime.createFile(to, content);
      useWorkspaceStore.getState().refresh();
      useWorkspaceStore.getState().syncBuffer(to);
      result.lines.push({ kind: 'muted', text: `copied ${from} → ${to}` });
      break;
    }

    case 'echo': {
      const text = args.join(' ');
      if (redirectTo) {
        runtime.createFile(redirectTo, text + '\n');
        useWorkspaceStore.getState().refresh();
        useWorkspaceStore.getState().syncBuffer(redirectTo);
        result.lines.push({ kind: 'muted', text: `wrote ${redirectTo}` });
      } else {
        result.lines.push({ kind: 'output', text });
      }
      break;
    }

    case 'tree': {
      const target = resolveArg(args[0] ?? '.', cwd);
      if (!runtime.isDirectory(target)) {
        pushError(`tree: not a directory: ${target}`);
        break;
      }
      result.lines.push({ kind: 'output', text: target === '/' ? '/' : target });
      result.lines.push(...printTree(target));
      break;
    }

    case 'open': {
      if (!args[0]) {
        pushError('open: missing file operand');
        break;
      }
      const target = resolveArg(args[0], cwd);
      if (!runtime.exists(target) || runtime.isDirectory(target)) {
        pushError(`open: no such file: ${target}`);
        break;
      }
      useWorkspaceStore.getState().openFile(target);
      result.lines.push({ kind: 'muted', text: `opened ${target}` });
      break;
    }

    case 'npm':
    case 'pnpm':
    case 'yarn': {
      result.lines.push({
        kind: 'muted',
        text: 'Package installation is not emulated here. The preview server maps React from a CDN; add other dependencies to package.json for documentation.',
      });
      break;
    }

    default:
      pushError(`command not found: ${command} (try 'help')`);
  }

  useUiStore.getState().setTerminalCwd(result.cwd);
  return result;
}
