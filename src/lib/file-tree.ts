import type { VirtualFS } from 'almostnode';
import { joinPath } from './paths';

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

const IGNORED = new Set(['node_modules', '.git', '.cache', '.nitro']);

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function walk(vfs: VirtualFS, dir: string): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const name of vfs.readdirSync(dir)) {
    if (IGNORED.has(name)) continue;
    const path = joinPath(dir, name);
    const stats = vfs.statSync(path);
    if (stats.isDirectory()) {
      nodes.push({ name, path, type: 'dir', children: walk(vfs, path) });
    } else {
      nodes.push({ name, path, type: 'file' });
    }
  }
  return sortNodes(nodes);
}

export function buildFileTree(vfs: VirtualFS): TreeNode[] {
  try {
    return walk(vfs, '/');
  } catch {
    return [];
  }
}

export function flattenLeaves(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) =>
    node.type === 'dir' ? flattenLeaves(node.children ?? []) : [node]
  );
}

export function countLeaves(nodes: TreeNode[]): number {
  return flattenLeaves(nodes).length;
}

export function allDirectories(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'dir' ? [node.path, ...allDirectories(node.children ?? [])] : []
  );
}

export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;

  const visit = (node: TreeNode): TreeNode | null => {
    if (node.type === 'file') {
      return node.name.toLowerCase().includes(needle) ? node : null;
    }
    const children = (node.children ?? []).map(visit).filter((child): child is TreeNode => !!child);
    if (children.length > 0 || node.name.toLowerCase().includes(needle)) {
      return { ...node, children };
    }
    return null;
  };

  return nodes.map(visit).filter((node): node is TreeNode => !!node);
}

export type LanguageId =
  | 'typescript'
  | 'typescriptreact'
  | 'javascript'
  | 'javascriptreact'
  | 'css'
  | 'html'
  | 'json'
  | 'markdown'
  | 'text';

export function languageFor(path: string): LanguageId {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return 'typescriptreact';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'javascriptreact';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  return 'text';
}

export function languageLabel(path: string): string {
  const language = languageFor(path);
  if (language === 'typescriptreact') return 'TSX';
  if (language === 'typescript') return 'TS';
  if (language === 'javascriptreact') return 'JSX';
  if (language === 'javascript') return 'JS';
  return language.toUpperCase();
}

const LANGUAGE_DOTS: Record<string, string> = {
  typescriptreact: '#4ea7ff',
  typescript: '#3f8fe0',
  javascriptreact: '#f0d264',
  javascript: '#e8c547',
  css: '#d47fe8',
  html: '#ef8354',
  json: '#9ccc65',
  markdown: '#9aa6a1',
  text: '#7b8a85',
};

export function languageColor(path: string): string {
  return LANGUAGE_DOTS[languageFor(path)] ?? LANGUAGE_DOTS.text;
}
