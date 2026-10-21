/**
 * The path a browser on the user's desktop can open. Under WSL the extension sees Linux paths,
 * but the browser runs on Windows: /home/u/x.cpp -> \\wsl.localhost\Ubuntu\home\u\x.cpp,
 * /mnt/c/Users/u/x.cpp -> C:\Users\u\x.cpp. Elsewhere the path is returned unchanged.
 */
export function browserVisiblePath(fsPath: string, env: NodeJS.ProcessEnv = process.env): string {
  const distro = env.WSL_DISTRO_NAME;
  if (!distro || !fsPath.startsWith('/')) return fsPath;

  const mounted = /^\/mnt\/([a-z])(\/.*)?$/i.exec(fsPath);
  if (mounted) return `${mounted[1].toUpperCase()}:${(mounted[2] ?? '/').replace(/\//g, '\\')}`;
  return `\\\\wsl.localhost\\${distro}${fsPath.replace(/\//g, '\\')}`;
}
