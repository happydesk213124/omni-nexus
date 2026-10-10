export function bindComfyHelp(): void {
  const button = document.getElementById('nx-comfy-help-open');
  const dialog = document.getElementById('nx-comfy-help') as HTMLDialogElement | null;
  const close = document.getElementById('nx-comfy-help-close');
  if (!button || !dialog || !close || button.dataset.comfyHelpBound) return;
  button.dataset.comfyHelpBound = '1';
  button.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
  });
  close.addEventListener('click', () => dialog.close());
}
