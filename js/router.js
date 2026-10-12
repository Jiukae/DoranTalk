// 주소 뒤의 #/이름 으로 화면을 바꾸는 간단한 길잡이(라우터)
// 예) #/login → 로그인 화면, #/group/그룹ID/feed → 그룹의 피드 화면

const routes = [];
let guard = () => null;
let cleanup = null;
let navCount = 0;

// 화면이 데이터를 불러오는 사이에 사용자가 다른 화면으로 갔는지 확인할 때 사용
// const token = navToken();  …await…  if (isStale(token)) return;
export function navToken() {
  return navCount;
}
export function isStale(token) {
  return token !== navCount;
}

// route('/group/:id/:tab', 그리는함수, { access: 'guest' | 'auth' | 'any' })
// 그리는 함수는 { id, tab } 같은 값을 받고, 화면을 떠날 때 실행할 정리 함수를 돌려줄 수 있어요.
export function route(pattern, render, { access = 'auth' } = {}) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  })}$`);
  routes.push({ regex, keys, render, access });
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

function match(path) {
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
      return { ...r, params };
    }
  }
  return null;
}

export async function handleRoute() {
  const path = currentPath();
  const found = match(path);
  if (!found) return go('/home', { replace: true });

  const redirect = guard(path, found.access);
  if (redirect && redirect !== path) return go(redirect, { replace: true });

  // 이전 화면이 켜 둔 실시간 연결 등을 정리
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch { /* 무시 */ }
  }
  cleanup = null;
  navCount += 1;
  const token = navCount;

  const result = await found.render(found.params);
  if (typeof result === 'function') {
    // 그리는 사이에 다른 화면으로 넘어갔다면 바로 정리
    if (isStale(token)) result();
    else cleanup = result;
  }
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  return handleRoute();
}
