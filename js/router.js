// 주소 뒤의 #/이름 으로 화면을 바꾸는 간단한 길잡이(라우터)
// 예) #/login → 로그인 화면, #/home → 홈 화면

const routes = new Map();
let guard = () => null;

// route('/login', 그리는함수, { access: 'guest' | 'auth' | 'any' })
export function route(path, render, { access = 'auth' } = {}) {
  routes.set(path, { render, access });
}

// 화면을 그리기 전에 "들어가도 되는지" 검사하는 함수 등록
export function setGuard(fn) {
  guard = fn;
}

export function currentPath() {
  const path = location.hash.replace(/^#/, '').split('?')[0];
  return path.startsWith('/') ? path : '';
}

export function go(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) {
    handleRoute();
  } else if (replace) {
    history.replaceState(history.state, '', target);
    handleRoute();
  } else {
    location.hash = target;
  }
}

export async function handleRoute() {
  const path = currentPath();
  const entry = routes.get(path);
  if (!entry) return go('/home', { replace: true });

  const redirect = guard(path, entry.access);
  if (redirect && redirect !== path) return go(redirect, { replace: true });

  await entry.render();
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  return handleRoute();
}
