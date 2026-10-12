import { afterEach, describe, expect, it, vi } from 'vitest';

const { createRoot, render } = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  createRoot: (...args: unknown[]) => {
    createRoot(...args);
    return { render };
  },
}));

vi.mock('../src/App.tsx', () => ({ default: () => null }));

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
  vi.clearAllMocks();
});

describe('frontend entry point', () => {
  it('mounts the application into the root element', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    await import('../src/main');

    expect(createRoot).toHaveBeenCalledWith(root);
    expect(render).toHaveBeenCalledOnce();
  });
});
