import { useState } from 'react';
import type { Project } from '../src/types';
import type { Config } from './api';
import { Button, Modal } from './common';

export function ConnectModal({ project, config, onClose }: { project: Project; config: Config; onClose: () => void }) {
  const [format, setFormat] = useState<'toml' | 'json'>('toml');
  const [copied, setCopied] = useState(false);
  const args = [config.cliPath, 'mcp', '--data-dir', config.dataDir, '--project', project.id];
  const snippet = format === 'toml'
    ? `[mcp_servers.hyperbench]\ncommand = ${JSON.stringify(config.nodePath)}\nargs = ${JSON.stringify(args)}\n`
    : JSON.stringify({ mcpServers: { hyperbench: { command: config.nodePath, args } } }, null, 2);
  async function copy() { try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } }
  return <Modal title="Connect your agent" onClose={onClose} wide>
    <div className="step-label"><span>1</span> Configure your MCP client</div>
    <div className="segmented"><button className={format === 'toml' ? 'active' : ''} onClick={() => setFormat('toml')}>TOML</button><button className={format === 'json' ? 'active' : ''} onClick={() => setFormat('json')}>JSON</button></div>
    <div className="snippet-heading"><span>{format === 'toml' ? 'MCP server configuration · TOML' : 'MCP server configuration · JSON'}</span><Button icon={copied ? 'check' : 'copy'} variant="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button></div>
    <pre className="code-snippet" tabIndex={0}>{snippet}</pre>
    <div className="step-label"><span>2</span> Reload your agent</div>
    <blockquote className="agent-prompt">Read my Hyperbench project context. Inspect the repositories and documents, cite file lines or document pages, and propose system changes as a draft for my review.</blockquote>
    <footer className="modal-actions"><Button onClick={onClose}>Done</Button></footer>
  </Modal>;
}
