import { probeCapabilities, resolveTier } from './capabilities.js';

async function main(): Promise<void> {
  const status = document.getElementById('status');
  const capabilities = await probeCapabilities(navigator, window);
  const tier = resolveTier(capabilities);

  const lines = [
    `<strong>Tier ${tier}</strong>`,
    ...Object.entries(capabilities).map(
      ([name, value]) => `${value ? '&check;' : '&cross;'} ${name}`,
    ),
  ];
  if (status) status.innerHTML = lines.join('<br />');

  console.info('[spatial-lingo] capabilities', capabilities, 'tier', tier);
}

void main();
