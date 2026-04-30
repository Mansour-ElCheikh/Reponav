import type { WebviewToExtensionMessage } from '../types';
import type { RouterContext } from './webviewMessageRouter';
import { routeWebviewMessage } from './webviewMessageRouter';

/**
 * Delegates webview message handling to the router module.
 * This is a pure seam-extracted handler for use in RepoNavWebviewProvider.
 */
export async function handleWebviewMessageDelegated(
  message: WebviewToExtensionMessage,
  ctx: RouterContext
): Promise<void> {
  await routeWebviewMessage(message, ctx);
}
