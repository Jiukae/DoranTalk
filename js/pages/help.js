// 사용 방법 화면 (#/help): 홈 화면 추가 · 처음 시작 · 소식 · 채팅 · 비밀번호 · 문제 해결
import { el, render, appBar, backButton, toast, icon, iconTile } from '../ui.js';
import { isLoggedIn } from '../state.js';
import { go } from '../router.js';
import { platform, isStandalone, canPromptInstall, promptInstall } from '../install.js';
import { APP_VERSION } from '../version.js';
import { CONTACT_EMAIL } from '../legal.js';
import { legalLinks } from './legal.js';

function section(iconName, title, ...children) {
  return el('section', { class: 'card help' },
    el('h2', {}, iconTile(iconName), title),
    ...children);
}

function steps(...items) {
  return el('ol', { class: 'steps' }, ...items.map((item) => el('li', {}, ...[].concat(item))));
}

function b(text) {
  return el('strong', {}, text);
}

function installSection() {
  const p = platform();
  const blocks = [];

  if (isStandalone()) {
    blocks.push(el('p', { class: 'form-msg success' }, '✓ 지금 홈 화면 앱으로 쓰고 계세요!'));
  } else if (canPromptInstall()) {
    blocks.push(el('button', {
      class: 'btn btn-block', type: 'button',
      onclick: async () => { if (await promptInstall()) toast('홈 화면에 추가했어요!'); },
    }, icon('download', { size: 22 }), '지금 홈 화면에 추가하기'));
  }

  const iphone = [
    el('h3', {}, '아이폰'),
    steps(
      ['사파리(Safari)로 ', b(location.host), ' 에 들어가요'],
      ['화면 아래(또는 주소창 옆)의 ', b('공유 버튼'), ' (네모에서 화살표가 위로 나온 모양 ⬆️)을 눌러요'],
      ['목록을 아래로 내려 ', b('"홈 화면에 추가"'), ' 를 눌러요'],
      ['오른쪽 위 ', b('"추가"'), ' 를 누르면 홈 화면에 도란톡 아이콘이 생겨요'],
    ),
  ];
  const android = [
    el('h3', {}, '갤럭시 · 안드로이드'),
    steps(
      [b('크롬(Chrome)'), ' 으로 ', b(location.host), ' 에 들어가요'],
      ['오른쪽 위 ', b('⋮'), ' (점 세 개)를 눌러요'],
      [b('"홈 화면에 추가"'), ' 또는 ', b('"앱 설치"'), ' 를 누르고 ', b('"설치"'), ' 를 눌러요'],
    ),
    el('p', { class: 'muted small' }, '삼성 인터넷이라면: 아래 ≡ 메뉴 → "현재 페이지 추가" → "홈 화면"'),
  ];
  const desktop = [
    el('h3', {}, '컴퓨터 (크롬·엣지)'),
    el('p', {}, '주소창 오른쪽 끝의 ', b('설치 아이콘'), '(모니터에 화살표 모양)을 누르고 ', b('"설치"'), ' 를 눌러요.'),
  ];
  const kakao = [
    el('h3', {}, '카카오톡으로 링크를 받았다면'),
    el('p', {}, '링크를 누르면 카카오톡 안에서 열려요. 오른쪽 아래(또는 위) ', b('⋮'), ' 를 눌러 ',
      b('"다른 브라우저로 열기"'), ' 를 고른 뒤, 위 방법대로 추가해 주세요.'),
  ];

  // 지금 쓰는 기기에 맞는 방법을 맨 위에
  const order = p === 'ios' ? [iphone, android, desktop] : p === 'desktop' ? [desktop, android, iphone] : [android, iphone, desktop];
  if (p === 'kakao' || p === 'inapp') order.unshift(kakao);
  else order.push(kakao);

  return section('phone', '홈 화면에 앱으로 추가하기',
    el('p', {}, '한 번 추가해 두면 다른 앱처럼 아이콘을 눌러 바로 열 수 있고, 로그인도 계속 유지돼요.'),
    ...blocks,
    ...order.flat(),
  );
}

export function renderHelp() {
  const back = backButton(() => (history.length > 1 ? history.back() : go(isLoggedIn() ? '/home' : '/login')));
  render(
    appBar('사용 방법', { left: back }),
    el('main', { class: 'page' },
      installSection(),

      section('sparkles', '처음 시작하기',
        steps(
          [b('회원가입'), ': 이메일, 비밀번호, ', b('닉네임'), '(가족이 나를 찾는 이름)을 정해요'],
          ['가족에게 내 ', b('닉네임'), ' 을 알려 줘요'],
          ['가족이 초대하면 홈 화면에 ', b('받은 초대'), ' 가 떠요 → ', b('수락하기')],
        ),
        el('p', { class: 'muted' }, '내가 그룹을 만들 수도 있어요: 홈 → "+ 새 가족 그룹 만들기" → 아래 "가족" 탭에서 가족의 닉네임으로 초대'),
      ),

      section('family', '아이(만 14세 미만)와 함께 쓰기',
        el('p', {}, '만 14세 미만 자녀는 ', b('보호자(부모님)의 동의'), '가 있어야 가입할 수 있어요.'),
        steps(
          ['보호자가 먼저 가입 → ', b('내 정보 → 자녀 계정'), ' → ', b('동의하고 가입 링크 만들기')],
          ['내용을 읽고 동의 → 내 비밀번호를 한 번 더 입력 → 만들어진 ', b('가입 링크'), '를 자녀에게 보내기'],
          ['자녀가 링크를 열어 가입 (7일 안에 한 번만 쓸 수 있어요). ', b('이미 가입한 자녀'), '는 자기 계정으로 로그인한 채 링크를 열고 ', b('"이 계정에 보호자 동의 연결하기"')],
          ['가족 그룹의 ', b('가족'), ' 탭에서 자녀의 닉네임으로 초대'],
        ),
        el('p', { class: 'muted' }, '자녀는 보호자가 들어 있는 가족 그룹에만 초대받을 수 있어요. 보호자는 언제든 자녀 계정을 지울 수 있어요(내 정보 → 자녀 계정).'),
      ),

      section('feed', '소식 (글과 사진)',
        el('ul', { class: 'bullets' },
          el('li', {}, '맨 위 ', b('"소식을 남겨 보세요"'), ' 칸 → 글 쓰기, ', b('사진 추가'), '(10장까지) → ', b('올리기')),
          el('li', {}, b('하트'), ' 를 누르면 빨간 하트로 바뀌어요. 다시 누르면 취소'),
          el('li', {}, b('댓글 쓰기'), ' 를 누르면 글 화면 아래에 댓글을 쓸 수 있어요'),
          el('li', {}, '내 글 오른쪽 위 ', b('점 세 개(⋯)'), ' → 아래에서 올라오는 메뉴에서 수정 / 삭제. 내 댓글은 아래 "수정 / 삭제"'),
          el('li', {}, '사진을 누르면 크게 보여요. 옆으로 밀면 다음 사진'),
        ),
      ),

      section('chat', '채팅',
        el('ul', { class: 'bullets' },
          el('li', {}, '아래 ', b('채팅'), ' 탭 → 글자를 쓰고 ', b('보내기'), '. 왼쪽 ', b('카메라 버튼'), ' 으로 사진도 보낼 수 있어요'),
          el('li', {}, '내 메시지 옆 ', el('strong', { class: 'chat-unread' }, '1'), ' 같은 숫자는 ', b('아직 안 읽은 가족 수'), '예요. 모두 읽으면 사라져요'),
          el('li', {}, '빨간 숫자(채팅 탭, 홈 화면)는 ', b('내가 아직 안 읽은 메시지 수'), '예요'),
        ),
      ),

      section('bell', '알림 받기',
        el('p', {}, '오른쪽 위 ', b('내 정보'), ' → ', b('알림'), ' → ', b('알림 켜기'), ' → 휴대폰이 물으면 ', b('허용'), '을 눌러요.'),
        el('ul', { class: 'bullets' },
          el('li', {}, '가족이 ', b('채팅'), ' · ', b('새 소식'), ' · 내 글에 ', b('댓글'), '을 남기거나 나를 ', b('초대'), '하면 알림이 와요'),
          el('li', {}, '앱을 닫아 두어도, 화면이 꺼져 있어도 와요. 알림을 누르면 그 화면이 바로 열려요'),
          el('li', {}, b('아이폰'), '은 먼저 위 방법대로 ', b('홈 화면에 추가'), '한 뒤, 그 아이콘으로 연 도란톡에서 켜야 해요 (iOS 16.4 이상)'),
          el('li', {}, '휴대폰이 인터넷에 연결되어 있어야 와요. 꺼져 있던 동안의 알림은 다시 연결되면 와요 (하루 안)'),
        ),
      ),

      section('palette', '화면 색 바꾸기',
        el('p', {}, '오른쪽 위 ', b('내 정보'), ' → ', b('배경 테마'), ' 에서 화이트 · 블랙 · 베이지 · 블루 중에 골라요. 누르면 바로 바뀌어요.'),
        el('p', { class: 'muted' }, '밤에 눈이 부시면 "블랙"을 써 보세요.'),
      ),

      section('key', '비밀번호를 잊었을 때',
        el('p', {}, '로그인 화면의 ', b('"비밀번호를 잊으셨나요?"'), ' → 가입한 이메일 입력 → 메일의 버튼을 누르면 새 비밀번호를 정할 수 있어요.'),
        el('p', { class: 'muted' }, '메일이 안 오면 스팸함을 확인하고, 그래도 없으면 가족 중 앱 관리자에게 알려 주세요.'),
      ),

      section('wrench', '잘 안 될 때',
        el('ul', { class: 'bullets' },
          el('li', {}, '앱을 ', b('완전히 닫았다가'), ' 다시 열어 보세요'),
          el('li', {}, '와이파이나 데이터가 켜져 있는지 확인해 주세요'),
          el('li', {}, el('a', { href: '#/check' }, '연결 점검'), ' 화면에서 빨간 표시가 있는지 확인하고, 화면을 캡처해 관리자에게 보내 주세요'),
        ),
        el('p', { class: 'muted small' }, `앱 버전: ${APP_VERSION}`),
        el('p', { class: 'muted small' }, '글꼴: 네이버 나눔스퀘어 네오 (© NAVER Corp.)'),
        el('p', { class: 'muted small' }, '문의: ', el('a', { href: `mailto:${CONTACT_EMAIL}` }, CONTACT_EMAIL)),
        legalLinks(),
      ),
    ),
  );
}
