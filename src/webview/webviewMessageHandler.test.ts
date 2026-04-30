
import { describe, it, expect, vi } from 'vitest';

vi.mock('./webviewMessageRouter', () => {
  return {
    routeWebviewMessage: vi.fn(),
  };
});

import { handleWebviewMessageDelegated } from './webviewMessageHandler';
import { routeWebviewMessage } from './webviewMessageRouter';

describe('handleWebviewMessageDelegated', () => {
  it('delegates to routeWebviewMessage with correct args', async () => {
    const message = { type: 'test', payload: {} } as any;
    const ctx = { foo: 'bar' } as any;
    await handleWebviewMessageDelegated(message, ctx);
    expect(routeWebviewMessage).toHaveBeenCalledWith(message, ctx);
  });
});
