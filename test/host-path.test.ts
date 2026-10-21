import { describe, expect, it } from 'vitest';
import { browserVisiblePath } from '../src/core/hostPath';

describe('browserVisiblePath', () => {
  const wsl = { WSL_DISTRO_NAME: 'Ubuntu' };

  it('maps WSL home paths to the \\\\wsl.localhost share', () => {
    expect(browserVisiblePath('/home/rajharsh/cp-test/sort.cpp', wsl)).toBe('\\\\wsl.localhost\\Ubuntu\\home\\rajharsh\\cp-test\\sort.cpp');
  });

  it('maps /mnt/<drive> paths back to Windows drives', () => {
    expect(browserVisiblePath('/mnt/c/Users/me/cp/A.cpp', wsl)).toBe('C:\\Users\\me\\cp\\A.cpp');
    expect(browserVisiblePath('/mnt/d', wsl)).toBe('D:\\');
  });

  it('leaves paths alone outside WSL', () => {
    expect(browserVisiblePath('/home/me/A.cpp', {})).toBe('/home/me/A.cpp');
    expect(browserVisiblePath('C:\\cp\\A.cpp', wsl)).toBe('C:\\cp\\A.cpp');
  });
});
