import {
  capabilitiesFromSession,
  OPTIONAL_FEATURES,
  probeCapabilities,
  resolveTier,
  type Capabilities,
} from './capabilities.js';

function render(capabilities: Capabilities): void {
  const status = document.getElementById('status');
  if (!status) return;
  const tier = resolveTier(capabilities);
  status.innerHTML = [
    `<strong>Tier ${tier}</strong>`,
    ...Object.entries(capabilities).map(
      ([name, value]) => `${value ? '&check;' : '&cross;'} ${name}`,
    ),
  ].join('<br />');
  console.info('[spatial-lingo] capabilities', capabilities, 'tier', tier);
}

async function main(): Promise<void> {
  let capabilities = await probeCapabilities(navigator, window);
  render(capabilities);

  if (!capabilities.immersiveAR) return;

  const button = document.createElement('button');
  button.textContent = 'Enter XR';
  button.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);padding:1rem 2rem;font-size:1rem;';
  document.body.append(button);

  button.addEventListener('click', async () => {
    try {
      const session = await navigator.xr!.requestSession('immersive-ar', {
        optionalFeatures: [...OPTIONAL_FEATURES],
      });
      capabilities = capabilitiesFromSession(session, capabilities);
      render(capabilities);
    } catch (error) {
      console.error('[spatial-lingo] session request failed', error);
    }
  });
}

void main();
