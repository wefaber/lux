// Lee --nombre valor o --nombre=valor de la línea de comandos.
export function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

export function flag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}
