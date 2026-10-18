// 사용 방법 화면 (#/help): 앱 설치(안드로이드 APK · 아이폰 홈 화면 추가) · 처음 시작 · 소식 · 채팅 · 비밀번호 · 문제 해결
import { el, render, appBar, backButton, icon, iconTile } from '../ui.js';
import { isLoggedIn } from '../state.js';
import { go } from '../router.js';
import { platform, isStandalone, isAndroidApp, ANDROID_APP } from '../install.js';
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

// 안드로이드에서 알림이 위에 팝업으로 안 뜰 때 (도움말 · 내 정보 → 알림에서 함께 써요)
// 안드로이드는 홈 화면 앱(웹 앱)의 알림을 "보통" 중요도로 등록해서, 처음에는 상태 표시줄 아이콘만 떠요.
// 웹 코드로는 이 중요도를 바꿀 수 없어서, 휴대폰 설정에서 한 번 "팝업"을 켜도록 안내해요.
export function popupHelp() {
  return el('details', { class: 'tip-box' },
    el('summary', {}, '알림이 위에 팝업으로 안 뜨나요? (안드로이드)'),
    !isAndroidApp() && el('p', {}, b('가장 확실한 방법: 도란톡 안드로이드 앱'), '을 설치하세요. 앱은 알림이 처음부터 위에 팝업으로 떠요. (홈 화면에 추가한 도란톡은 크롬이 알림을 "보통"으로 정해서 아이콘만 떠요)'),
    !isAndroidApp() && el('a', { class: 'btn btn-secondary btn-block', href: '#/help' }, icon('download', { size: 20 }), '안드로이드 앱 받는 방법'),
    el('p', {}, isAndroidApp() ? '휴대폰 설정에서 알림 팝업이 꺼져 있으면 아래처럼 켜 주세요.' : '앱을 설치하지 않고 바꾸려면, 휴대폰 설정에서 아래처럼 켜 보세요. (휴대폰에 따라 안 될 수도 있어요)'),
    el('h3', {}, '갤럭시'),
    el('p', {}, '앱 화면의 "알림 팝업"에 체크해도 진동만 오면, 알림 ', b('종류(카테고리)'), '가 아직 "보통"이에요. 그것까지 바꿔 줘야 해요.'),
    steps(
      ['가장 쉬운 방법: 도란톡 알림이 왔을 때 알림창을 내려 그 알림을 ', b('길게 누르기'), ' → ', b('⚙ 설정'), '(또는 "알림 설정")'],
      ['열린 화면에서 ', b('팝업으로 표시'), '(또는 "소리 및 팝업")을 켜요'],
      ['길게 눌러도 안 나오면: ', b('설정'), ' → ', b('알림'), ' → ', b('고급 설정'), ' → ', b('알림 카테고리 관리'), ' 켜기 → 다시 ', b('앱 알림'), ' → ', b('도란톡'), ' → 맨 아래 ', b('알림 카테고리'), ' → 항목(예: 일반)을 눌러 ', b('팝업으로 표시'), ' 켜기'],
    ),
    el('p', { class: 'muted small' }, '휴대폰마다 메뉴 이름이 조금 달라요. 비슷한 이름을 찾아 주세요.'),
    el('h3', {}, '다른 안드로이드 (픽셀 등)'),
    steps(
      [b('설정'), ' → ', b('앱'), ' → ', b('도란톡'), ' → ', b('알림')],
      [b('일반'), '을 누르고 ', b('화면에 팝업'), '을 켜요 (중요도가 보이면 ', b('높음'), ' 또는 ', b('긴급'), ')'],
    ),
    el('p', { class: 'muted small' }, '앱 목록에 도란톡이 없으면 크롬 안에서 쓰고 있는 거예요. 같은 방법으로 ', b('Chrome'), ' → 알림 → ', b('사이트'), ' → dorantalk.com 에서 팝업을 켜 주세요.'),
  );
}

// 안드로이드 앱(APK) 받기 버튼 + 설치 방법
function androidAppBlock() {
  return [
    el('a', { class: 'btn btn-block', href: ANDROID_APP.url, download: 'dorantalk.apk' },
      icon('download', { size: 22 }), '안드로이드 앱 받기'),
    el('p', { class: 'muted small center' }, `버전 ${ANDROID_APP.version} · 약 ${ANDROID_APP.size} · 안드로이드 7.0 이상`),
    steps(
      ['위 버튼을 눌러 파일을 받아요 (크롬이 "위험할 수 있는 파일"이라고 물으면 ', b('다운로드'), ')'],
      ['예전에 홈 화면에 추가한 도란톡이 있으면 ', b('먼저 지워요'), ' (그 아이콘을 길게 누르기 → ', b('삭제'), '). 이름이 같아서 헷갈리지 않게요'],
      ['받은 파일을 열어요: 알림창의 ', b('다운로드 완료'), ' 또는 ', b('내 파일 → 다운로드 → dorantalk.apk')],
      [b('"출처를 알 수 없는 앱"'), ' 안내가 나오면 ', b('설정'), ' → ', b('이 출처 허용'), ' 켜기 → 뒤로'],
      [b('설치'), ' → ', b('열기'), ' (Play 프로텍트가 물으면 ', b('세부정보 더보기 → 무시하고 설치'), ')'],
    ),
    el('p', { class: 'muted small' }, '앱을 쓰면 알림이 카카오톡처럼 위에 팝업으로 떠요. 로그인은 보통 그대로 유지돼요.'),
  ];
}

function installSection() {
  const p = platform();
  const blocks = [];

  if (isAndroidApp()) {
    blocks.push(el('p', { class: 'form-msg success' }, '✓ 지금 도란톡 안드로이드 앱으로 쓰고 계세요!'));
  } else if (isStandalone() && p === 'android') {
    blocks.push(el('p', { class: 'note-box' }, '지금은 홈 화면에 추가한 도란톡이에요. 아래 ', b('안드로이드 앱'), '으로 바꾸면 알림이 위에 팝업으로 떠요.'));
  } else if (isStandalone()) {
    blocks.push(el('p', { class: 'form-msg success' }, '✓ 지금 홈 화면 앱으로 쓰고 계세요!'));
  }

  const android = [
    el('h3', {}, '갤럭시 · 안드로이드'),
    ...(isAndroidApp() ? [el('p', { class: 'muted' }, '이미 설치되어 있어요. 가족에게 이 화면(사용 방법)을 알려 주면 같은 방법으로 받을 수 있어요.')] : androidAppBlock()),
  ];
  const iphone = [
    el('h3', {}, '아이폰'),
    steps(
      ['사파리(Safari)로 ', b(location.host), ' 에 들어가요'],
      ['화면 아래(또는 주소창 옆)의 ', b('공유 버튼'), ' (네모에서 화살표가 위로 나온 모양 ⬆️)을 눌러요'],
      ['목록을 아래로 내려 ', b('"홈 화면에 추가"'), ' 를 눌러요'],
      ['오른쪽 위 ', b('"추가"'), ' 를 누르면 홈 화면에 도란톡 아이콘이 생겨요'],
    ),
    el('p', { class: 'muted small' }, '아이폰은 이렇게 홈 화면에 추가한 도란톡에서 알림을 받을 수 있어요. (iOS 16.4 이상)'),
  ];
  const desktop = [
    el('h3', {}, '컴퓨터 (크롬·엣지)'),
    el('p', {}, '주소창 오른쪽 끝의 ', b('설치 아이콘'), '(모니터에 화살표 모양)을 누르고 ', b('"설치"'), ' 를 눌러요.'),
  ];
  const kakao = [
    el('h3', {}, '카카오톡으로 링크를 받았다면'),
    el('p', {}, '링크를 누르면 카카오톡 안에서 열려요. 오른쪽 아래(또는 위) ', b('⋮'), ' 를 눌러 ',
      b('"다른 브라우저로 열기"'), ' 를 고른 뒤, 아래 방법대로 설치해 주세요.'),
  ];

  // 지금 쓰는 기기의 방법만 펼쳐 보여 주고, 다른 기기 방법은 접어 둬요
  let main;
  let others;
  if (p === 'ios') { main = [iphone]; others = [android, desktop]; }
  else if (p === 'desktop') { main = [desktop]; others = [android, iphone]; }
  else if (p === 'kakao' || p === 'inapp') { main = [kakao, android, iphone]; others = [desktop]; }
  else { main = [android]; others = [iphone, desktop]; }

  return section('phone', '앱 설치하기',
    el('p', {}, '한 번 설치해 두면 다른 앱처럼 아이콘을 눌러 바로 열 수 있고, 로그인도 계속 유지돼요.'),
    ...blocks,
    ...main.flat(),
    el('details', { class: 'tip-box other-devices' },
      el('summary', {}, p === 'desktop' ? '휴대폰에 설치하기' : '다른 기기에 설치하기'),
      ...others.flat(),
    ),
  );
}

// 계정 지우기(탈퇴) 방법 — 도움말과 #/delete-account(Play 스토어 "계정 삭제 안내" 주소)에서 함께 써요
function deleteSection() {
  return section('trash', '계정 지우기 (회원 탈퇴)',
    steps(
      ['도란톡에 로그인해요'],
      ['오른쪽 위 ', b('내 정보'), ' → 맨 아래 ', b('회원 탈퇴'), ' 를 눌러요'],
      ['안내를 읽고 확인 칸에 체크한 뒤 ', b('회원 탈퇴하기'), ' → ', b('탈퇴하기'), ' 를 누르면 끝이에요'],
    ),
    el('p', {}, '탈퇴하면 아이디·닉네임·이메일과 내가 쓴 글·댓글·하트·채팅·사진이 ', b('바로 삭제'), '되고 되돌릴 수 없어요. 혼자 남아 있던 그룹도 함께 지워져요.'),
    el('p', { class: 'muted' }, '로그인이 안 되면 가입한 이메일로 ', el('a', { href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('도란톡 계정 삭제 요청')}` }, CONTACT_EMAIL),
      ' 에 "계정 삭제 요청"이라고 보내 주세요. 본인 확인 뒤 7일 안에 지워 드려요. 만 14세 미만 회원은 보호자가 ', b('내 정보 → 자녀 계정'), '에서 바로 지울 수도 있어요.'),
    isLoggedIn() && el('a', { href: '#/me/delete', class: 'btn btn-ghost btn-block btn-danger-text' }, '회원 탈퇴 화면으로 가기'),
  );
}

export function renderDeleteGuide() {
  const back = backButton(() => (history.length > 1 ? history.back() : go(isLoggedIn() ? '/home' : '/login')));
  render(
    appBar('계정 삭제 안내', { left: back }),
    el('main', { class: 'page' },
      deleteSection(),
      el('p', { class: 'muted small' }, '도란톡 · 문의: ', el('a', { href: `mailto:${CONTACT_EMAIL}` }, CONTACT_EMAIL)),
      legalLinks(),
    ),
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
          [b('회원가입'), ': 이메일, 비밀번호, ', b('아이디'), '(다른 사람과 겹치지 않는 이름, 한글도 돼요), ', b('닉네임'), '(그룹에서 보이는 이름)을 정해요'],
          ['함께할 사람에게 내 ', b('아이디'), ' 를 알려 줘요 (내 정보에서 볼 수 있어요)'],
          ['누가 초대하면 홈 화면의 ', b('받은 초대'), ' 와 ', b('이메일'), '로 알려 드려요 → ', b('수락하기')],
        ),
        el('p', { class: 'muted' }, '내가 그룹을 만들 수도 있어요: 홈 → "+ 새 그룹 만들기" → 아래 "멤버" 탭에서 아이디로 초대'),
        el('p', { class: 'muted' }, '프로필 사진: 내 정보 → 프로필 사진 → "사진 올리기" (또는 동그라미 색 고르기). 같은 그룹 가족에게 보여요.'),
      ),

      section('family', '아이(만 14세 미만)와 함께 쓰기',
        el('p', {}, '만 14세 미만 자녀는 ', b('보호자(부모님)의 동의'), '가 있어야 가입할 수 있어요.'),
        steps(
          ['보호자가 먼저 가입 → ', b('내 정보 → 자녀 계정'), ' → ', b('동의하고 가입 링크 만들기')],
          ['내용을 읽고 동의 → 내 비밀번호를 한 번 더 입력 → 만들어진 ', b('가입 링크'), '를 자녀에게 보내기'],
          ['자녀가 링크를 열어 가입 (7일 안에 한 번만 쓸 수 있어요). ', b('이미 가입한 자녀'), '는 자기 계정으로 로그인한 채 링크를 열고 ', b('"이 계정에 보호자 동의 연결하기"')],
          ['그룹의 ', b('멤버'), ' 탭에서 자녀의 ', b('아이디'), '로 초대'],
        ),
        el('ul', { class: 'bullets' },
          el('li', {}, '자녀는 보호자가 들어 있는 그룹에만 초대받을 수 있어요. 보호자가 있는 그룹이면 ', b('누가 초대해도'), ' 자녀가 수락할 수 있어요.'),
          el('li', {}, '자녀가 그룹을 만들고 싶으면 ', b('새 그룹 만들기 → 보호자에게 승인 요청'), '. 보호자에게 이메일이 가고, 보호자가 ', b('내 정보 → 자녀 계정'), '에서 승인하면 그룹이 생겨요 (보호자도 멤버가 돼요).'),
          el('li', {}, '보호자는 언제든 자녀 계정을 지울 수 있어요 (내 정보 → 자녀 계정).'),
        ),
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
          el('li', {}, '내 메시지 옆 ', el('strong', { class: 'chat-unread' }, '1'), ' 같은 숫자는 ', b('아직 안 읽은 멤버 수'), '예요. 모두 읽으면 사라져요'),
          el('li', {}, '빨간 숫자(채팅 탭, 홈 화면)는 ', b('내가 아직 안 읽은 메시지 수'), '예요'),
        ),
      ),

      section('bell', '알림 받기',
        el('p', {}, '오른쪽 위 ', b('내 정보'), ' → ', b('알림'), ' → ', b('알림 켜기'), ' → 휴대폰이 물으면 ', b('허용'), '을 눌러요.'),
        el('ul', { class: 'bullets' },
          el('li', {}, '그룹 멤버가 ', b('채팅'), ' · ', b('새 소식'), ' · 내 글에 ', b('댓글'), '을 남기거나 누가 나를 ', b('초대'), '하면 알림이 와요'),
          el('li', {}, '앱을 닫아 두어도, 화면이 꺼져 있어도 와요. 알림을 누르면 그 화면이 바로 열려요'),
          el('li', {}, b('아이폰'), '은 먼저 위 방법대로 ', b('홈 화면에 추가'), '한 뒤, 그 아이콘으로 연 도란톡에서 켜야 해요 (iOS 16.4 이상)'),
          el('li', {}, '휴대폰이 인터넷에 연결되어 있어야 와요. 꺼져 있던 동안의 알림은 다시 연결되면 와요 (하루 안)'),
        ),
        popupHelp(),
      ),

      section('palette', '화면 색 바꾸기',
        el('p', {}, '오른쪽 위 ', b('내 정보'), ' → ', b('배경 테마'), ' 에서 화이트 · 블랙 · 베이지 · 블루 중에 골라요. 누르면 바로 바뀌어요.'),
        el('p', { class: 'muted' }, '밤에 눈이 부시면 "블랙"을 써 보세요.'),
      ),

      section('key', '비밀번호를 잊었을 때',
        el('p', {}, '로그인 화면의 ', b('"비밀번호를 잊으셨나요?"'), ' → 가입한 이메일 입력 → 메일의 버튼을 누르면 새 비밀번호를 정할 수 있어요.'),
        el('p', { class: 'muted' }, '메일이 안 오면 스팸함을 확인하고, 그래도 없으면 가족 중 앱 관리자에게 알려 주세요.'),
      ),

      deleteSection(),

      section('wrench', '잘 안 될 때',
        el('ul', { class: 'bullets' },
          el('li', {}, '앱을 ', b('완전히 닫았다가'), ' 다시 열어 보세요'),
          el('li', {}, '와이파이나 데이터가 켜져 있는지 확인해 주세요'),
          el('li', {}, '그래도 안 되면 화면을 캡처해 ', b('내 정보 → 문의하기'), '로 보내 주세요'),
        ),
        el('p', { class: 'muted small' }, `앱 버전: ${APP_VERSION}`),
        el('p', { class: 'muted small' }, '글꼴: 네이버 나눔스퀘어 네오 (© NAVER Corp.)'),
        el('p', { class: 'muted small' }, '문의: ', el('a', { href: `mailto:${CONTACT_EMAIL}` }, CONTACT_EMAIL)),
        legalLinks(),
      ),
    ),
  );
}
