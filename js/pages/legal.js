// 개인정보처리방침(#/privacy) · 이용약관(#/terms) · 약관 동의(#/consent) 화면, 가입용 동의 체크 묶음
import { sb } from '../supabase.js';
import { forgetThisDevice } from '../push.js';
import { state, isLoggedIn } from '../state.js';
import { go } from '../router.js';
import { friendlyError } from '../errors.js';
import { el, render, appBar, backButton, brandHeader, messageBox, setBusy, toast } from '../ui.js';
import {
  SERVICE_NAME, SERVICE_URL, PRIVACY_OFFICER, CONTACT_EMAIL, EFFECTIVE_DATE, consentRecord,
} from '../legal.js';

// ------------------------------------------------------------------
// 문서 조각
// ------------------------------------------------------------------
const p = (...c) => el('p', {}, ...c);
const b = (t) => el('strong', {}, t);
const ul = (...items) => el('ul', { class: 'bullets' }, ...items.map((i) => el('li', {}, ...[].concat(i))));
const mail = () => el('a', { href: `mailto:${CONTACT_EMAIL}` }, CONTACT_EMAIL);

function article(title, ...children) {
  return el('section', { class: 'legal-article' }, el('h2', {}, title), ...children);
}

function table(headers, rows) {
  return el('div', { class: 'legal-table-wrap' },
    el('table', { class: 'legal-table' },
      el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c, i) => el('td', { 'data-label': headers[i] }, c))))),
    ));
}

function legalPage(title, intro, ...articles) {
  const back = backButton(() => (history.length > 1 ? history.back() : go(isLoggedIn() ? '/home' : '/login')));
  render(
    appBar(title, { left: back }),
    el('main', { class: 'page' },
      el('div', { class: 'card legal' },
        el('h1', {}, title),
        el('p', { class: 'muted' }, intro),
        ...articles,
        el('p', { class: 'muted small legal-date' }, `시행일: ${EFFECTIVE_DATE}`),
        title === '개인정보처리방침' && el('p', { class: 'muted small' }, '개정: 2026년 10월 15일 — 휴대폰 알림(선택 기능) 관련 내용 추가 / 2026년 10월 16일 — 가입 경로 항목 추가'),
      ),
    ),
  );
}

// ------------------------------------------------------------------
// 개인정보처리방침
// ------------------------------------------------------------------
export function renderPrivacy() {
  legalPage('개인정보처리방침',
    `${SERVICE_NAME}(${SERVICE_URL}, 이하 "서비스")은 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고, 관련 고충을 신속하게 처리하기 위해 다음과 같이 개인정보처리방침을 공개합니다.`,

    article('1. 개인정보를 쓰는 목적',
      ul(
        [b('회원 가입과 관리'), ': 본인 확인, 로그인, 닉네임 중복 확인, 비밀번호 재설정 메일 발송'],
        [b('서비스 제공'), ': 가족 그룹 만들기·초대, 소식(글·사진·댓글·하트), 채팅, 안 읽은 메시지 표시, 휴대폰 알림(켠 경우)'],
        [b('문의 응대와 안전한 운영'), ': 문의 답변, 부정 이용 방지, 서비스 오류 확인, 가입 경로 통계(어느 홍보를 보고 가입했는지 숫자로만 확인)'],
      ),
      p('위 목적 외의 용도로는 쓰지 않으며, 목적이 바뀌면 미리 알리고 필요한 경우 다시 동의를 받습니다. 광고·마케팅에 쓰지 않습니다.'),
    ),

    article('2. 수집하는 개인정보 항목',
      table(['구분', '항목', '수집 방법'], [
        ['필수 (가입할 때)', '이메일 주소, 비밀번호(암호화되어 저장), 닉네임, 만 14세 이상 확인 및 약관 동의 기록', '회원가입 화면'],
        ['서비스 이용 중 만들어지는 정보', '가족 그룹 이름, 그룹 참여·초대 기록, 글·댓글·하트, 채팅 메시지, 사진, 메시지를 읽은 시각', '이용자가 직접 입력·업로드'],
        ['선택 (알림을 켠 경우)', '이 기기의 알림 받을 주소(웹 푸시 구독 정보), 기기 종류(안드로이드·아이폰·컴퓨터)', '"알림 켜기"를 누를 때'],
        ['자동으로 생기는 정보', '접속 IP 주소, 접속 시각, 브라우저·기기 정보(서버 기록), 가입 경로(홍보 링크로 들어온 경우, 예: 인스타그램)', '서비스 이용 과정에서 자동 생성'],
        ['기기에만 저장', '로그인 유지 정보, 화면 테마 설정', '이용자 기기의 브라우저 저장소'],
      ]),
    ),

    article('3. 보유 기간',
      p('회원의 개인정보는 ', b('회원 탈퇴 시까지'), ' 보유하고, 탈퇴하면 지체 없이 삭제합니다.'),
      ul(
        '탈퇴하면 내 닉네임·이메일과 내가 쓴 글·댓글·하트·채팅·사진이 함께 삭제됩니다.',
        '내가 혼자 남아 있던 가족 그룹은 그룹 전체가 삭제됩니다.',
        '알림 받을 주소는 알림을 끄거나, 그 기기에서 로그아웃하거나, 탈퇴하면 바로 삭제됩니다.',
        '서버 접속 기록과 시스템 백업에 남은 정보는 아래 업체의 보관 주기가 지나면 자동으로 삭제됩니다.',
        '다른 법령에서 보관을 요구하는 경우에는 그 기간 동안만 따로 보관합니다.',
      ),
    ),

    article('4. 파기 절차와 방법',
      p('보유 기간이 끝나거나 처리 목적을 이루면 지체 없이 파기합니다. 전자 파일은 복구할 수 없는 방법으로 삭제하며, 종이 문서는 만들지 않습니다.'),
    ),

    article('5. 제3자 제공',
      p('이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 근거가 있거나 수사기관이 법령에 정한 절차에 따라 요청하는 경우는 예외로 합니다.'),
    ),

    article('6. 처리 위탁과 국외 이전',
      p('서비스 운영을 위해 아래 업체에 개인정보 처리를 맡기고 있으며, 이 과정에서 개인정보가 국외로 전송·보관될 수 있습니다. 개인정보는 서비스를 이용하는 동안 인터넷(암호화 통신)으로 수시로 전송됩니다.'),
      table(['받는 업체 (국가)', '맡기는 일', '이전되는 항목', '보관 위치·기간'], [
        ['Supabase Inc. (미국)', '회원 인증, 데이터베이스, 사진 저장, 실시간 전송', '가입 정보, 서비스 이용 중 만들어지는 정보 전부', '대한민국(서울) 데이터센터 · 회원 탈퇴 또는 위탁 종료 시까지'],
        ['Netlify, Inc. (미국)', '웹사이트(앱 화면) 전송', '접속 IP 주소, 접속 기록', '전 세계 전송망 · 업체 보관 주기에 따름'],
        ['Resend (미국)', '비밀번호 재설정 메일 발송', '이메일 주소', '일본(도쿄) 발송 서버 · 업체 보관 주기에 따름'],
        ['ImprovMX (미국)', '문의 메일 전달', '문의 메일을 보낸 분의 이메일 주소와 메일 내용', '업체 보관 주기에 따름'],
        ['Google · Apple · Mozilla (미국) — 알림을 켠 경우', '휴대폰 알림 전달 (각 휴대폰 · 브라우저의 기본 알림 서버)', '암호화된 알림 내용 (업체는 내용을 열어 볼 수 없음), 알림 받을 주소', '전달될 때까지 최대 1일'],
      ]),
      p('국외 이전을 원하지 않으시면 회원가입을 하지 않거나 탈퇴할 수 있습니다. 다만 위 업체 없이는 서비스를 제공할 수 없어 이용이 불가능합니다.'),
    ),

    article('7. 이용자의 권리와 행사 방법',
      p('이용자는 언제든지 자신의 개인정보를 열람·정정·삭제하거나 처리를 멈추도록 요구할 수 있고, 동의를 철회할 수 있습니다.'),
      ul(
        [b('열람·정정'), ': 앱의 ', b('내 정보'), '에서 닉네임과 이메일을 확인하고 닉네임을 바꿀 수 있습니다.'],
        [b('삭제'), ': 내 글·댓글은 언제든 지울 수 있고, ', b('내 정보 → 회원 탈퇴'), '로 계정과 모든 정보를 지울 수 있습니다.'],
        ['그 밖의 요청은 ', mail(), ' 으로 보내 주시면 지체 없이 처리합니다.'],
      ),
      p(b('만 14세 미만 아동은 가입할 수 없습니다.'), ' 만 14세 미만의 개인정보가 수집된 사실을 알게 되면 즉시 삭제합니다.'),
    ),

    article('8. 개인정보를 안전하게 지키는 방법',
      ul(
        '모든 통신은 암호화(HTTPS)됩니다.',
        '비밀번호는 원래 글자를 알 수 없는 방식(단방향 암호화)으로 저장합니다.',
        '데이터베이스의 보안 규칙으로, 같은 가족 그룹 멤버만 그 그룹의 글·댓글·채팅·사진을 볼 수 있습니다.',
        '사진은 비공개 저장소에 보관하고, 볼 때마다 짧은 시간만 쓸 수 있는 임시 주소를 만듭니다.',
        '관리용 비밀 키는 앱에 넣지 않고 따로 관리합니다.',
      ),
    ),

    article('9. 자동으로 정보를 모으는 장치(쿠키 등)',
      p('광고나 분석을 위한 쿠키를 쓰지 않습니다. 로그인 유지와 화면 테마 설정을 위해 이용자 기기의 브라우저 저장소를 사용하며, 브라우저 설정에서 사이트 데이터를 지우면 삭제됩니다(이 경우 다시 로그인해야 합니다).'),
    ),

    article('10. 개인정보 보호책임자',
      table(['구분', '내용'], [
        ['성명', PRIVACY_OFFICER],
        ['직위', `${SERVICE_NAME} 운영자`],
        ['연락처', mail()],
      ]),
      p('개인정보와 관련한 문의·불만·피해 구제 요청은 위 연락처로 보내 주세요. 지체 없이 답변하고 처리하겠습니다.'),
    ),

    article('11. 권익 침해 구제 방법',
      p('개인정보 침해에 대한 신고나 상담이 필요하시면 아래 기관에 문의하실 수 있습니다.'),
      ul(
        '개인정보침해신고센터: (국번 없이) 118 · privacy.kisa.or.kr',
        '개인정보분쟁조정위원회: 1833-6972 · www.kopico.go.kr',
        '대검찰청: (국번 없이) 1301 · www.spo.go.kr',
        '경찰청: (국번 없이) 182 · ecrm.police.go.kr',
      ),
    ),

    article('12. 방침의 변경',
      p('이 방침이 바뀌면 시행 7일 전부터 앱에서 알리고, 중요한 변경은 다시 동의를 받습니다.'),
    ),
  );
}

// ------------------------------------------------------------------
// 이용약관
// ------------------------------------------------------------------
export function renderTerms() {
  legalPage('이용약관',
    `이 약관은 ${SERVICE_NAME}(${SERVICE_URL}, 이하 "서비스")을 이용하는 데 필요한 운영자와 회원의 권리·의무를 정합니다.`,

    article('제1조 (목적)',
      p(`이 약관은 운영자가 제공하는 ${SERVICE_NAME} 서비스의 이용 조건과 절차, 운영자와 회원의 권리·의무 및 책임을 정하는 것을 목적으로 합니다.`)),

    article('제2조 (용어)',
      ul(
        [b('서비스'), ': 가족끼리 소식(글·사진·댓글·하트)과 채팅을 나누는 도란톡 웹 앱'],
        [b('회원'), ': 이 약관에 동의하고 가입한 사람'],
        [b('가족 그룹'), ': 회원이 만들고 닉네임으로 초대한 사람들이 모이는 공간'],
        [b('게시물'), ': 회원이 서비스에 올린 글, 사진, 댓글, 채팅 메시지 등'],
      )),

    article('제3조 (약관의 효력과 변경)',
      p('이 약관은 서비스 화면에 게시하여 효력이 생깁니다. 운영자는 관련 법령을 어기지 않는 범위에서 약관을 바꿀 수 있으며, 바꿀 때는 시행 7일 전(회원에게 불리한 변경은 30일 전)부터 서비스에 알립니다. 회원이 바뀐 약관에 동의하지 않으면 탈퇴할 수 있습니다.')),

    article('제4조 (회원가입)',
      ul(
        '가입하려는 사람이 약관과 개인정보 수집·이용에 동의하고 가입 정보를 입력하면 가입이 이루어집니다.',
        [b('만 14세 미만은 가입할 수 없습니다.')],
        '다른 사람의 이메일을 도용하거나 거짓 정보로 가입하면 이용이 제한될 수 있습니다.',
      )),

    article('제5조 (계정 관리)',
      p('회원은 자신의 이메일과 비밀번호를 안전하게 관리해야 하며, 다른 사람에게 빌려주거나 넘길 수 없습니다. 계정이 도용된 것을 알게 되면 바로 비밀번호를 바꾸고 운영자에게 알려 주세요.')),

    article('제6조 (서비스 내용)',
      p('운영자는 회원에게 가족 그룹 만들기와 초대, 소식(글·사진·댓글·하트), 채팅, 사진 저장 기능을 ', b('무료'), '로 제공합니다. 같은 가족 그룹의 멤버만 그 그룹의 게시물을 볼 수 있습니다.')),

    article('제7조 (서비스의 변경과 중단)',
      ul(
        '운영자는 점검, 장비 고장, 외부 업체(호스팅·데이터베이스 등)의 장애가 있을 때 서비스를 잠시 멈출 수 있습니다.',
        '운영자는 서비스 내용을 바꾸거나 서비스를 끝낼 수 있으며, 끝낼 때는 30일 전에 서비스에 알립니다.',
      )),

    article('제8조 (게시물의 권리와 책임)',
      ul(
        '게시물의 저작권은 그 게시물을 올린 회원에게 있습니다.',
        '운영자는 게시물을 같은 가족 그룹 멤버에게 보여 주기 위해 필요한 범위에서만 저장·전송·표시하며, 그 밖의 용도로 쓰지 않습니다.',
        '게시물에 대한 책임은 올린 회원에게 있습니다. 다른 사람의 사진이나 정보를 올릴 때는 그 사람의 동의를 받아 주세요.',
        '회원이 탈퇴하면 그 회원의 게시물은 삭제됩니다.',
      )),

    article('제9조 (금지 행위)',
      p('회원은 다음 행위를 해서는 안 됩니다.'),
      ul(
        '다른 사람의 개인정보·계정을 도용하거나, 다른 사람을 사칭하는 행위',
        '불법 촬영물, 음란물, 폭력·혐오·차별을 조장하는 게시물을 올리는 행위',
        '다른 사람의 저작권·초상권·사생활 등 권리를 침해하는 행위',
        '광고·스팸을 보내거나, 원하지 않는 사람에게 초대를 반복해서 보내는 행위',
        '서비스를 해킹하거나 정상적인 운영을 방해하는 행위',
        '그 밖에 법령에 어긋나는 행위',
      )),

    article('제10조 (이용 제한)',
      p('회원이 제9조를 어기면 운영자는 경고, 일시 이용 정지, 계정 삭제 등의 조치를 할 수 있습니다. 회원은 이에 대해 운영자에게 이의를 제기할 수 있습니다.')),

    article('제11조 (회원 탈퇴)',
      p('회원은 언제든지 ', b('내 정보 → 회원 탈퇴'), '에서 탈퇴할 수 있습니다. 탈퇴하면 계정과 게시물이 바로 삭제되며 되돌릴 수 없습니다.')),

    article('제12조 (책임의 제한)',
      ul(
        '서비스는 무료로 제공되며, 운영자는 천재지변, 외부 업체 장애, 회원의 잘못 등 운영자에게 책임이 없는 사유로 생긴 손해에 대해 책임지지 않습니다. 다만 운영자의 고의 또는 중대한 과실로 생긴 손해는 예외로 합니다.',
        '운영자는 회원끼리 생긴 다툼에 끼어들 의무가 없습니다.',
        '소중한 사진은 휴대폰 등에도 따로 보관해 주세요.',
      )),

    article('제13조 (준거법과 관할)',
      p('이 약관과 서비스 이용에 관한 분쟁에는 대한민국 법을 적용하며, 분쟁이 생기면 민사소송법에 따른 관할 법원에서 해결합니다.')),

    article('부칙', p(`이 약관은 ${EFFECTIVE_DATE}부터 시행합니다.`), p('문의: ', mail())),
  );
}

// ------------------------------------------------------------------
// 동의 체크 묶음 (회원가입 화면, 약관 동의 화면에서 사용)
// ------------------------------------------------------------------
export function consentChecklist() {
  const items = [
    { key: 'age', label: '[필수] 만 14세 이상이에요' },
    { key: 'terms', label: '[필수] 이용약관에 동의해요', link: '#/terms' },
    {
      key: 'privacy', label: '[필수] 개인정보 수집·이용에 동의해요', link: '#/privacy',
      summary: [
        '수집 항목: 이메일, 비밀번호, 닉네임',
        '쓰는 목적: 회원 확인, 가족 소식·채팅 서비스 제공, 비밀번호 찾기',
        '보유 기간: 회원 탈퇴할 때까지 (탈퇴하면 바로 삭제)',
        '동의하지 않을 수 있지만, 그러면 가입할 수 없어요.',
      ],
    },
  ];
  const boxes = {};
  const all = el('input', { type: 'checkbox', class: 'check-input', id: 'consent-all' });
  const rows = items.map((it) => {
    const box = el('input', { type: 'checkbox', class: 'check-input', id: `consent-${it.key}` });
    boxes[it.key] = box;
    box.addEventListener('change', () => { all.checked = Object.values(boxes).every((x) => x.checked); });
    return el('div', { class: 'consent-row' },
      el('label', { class: 'consent-label', for: box.id }, box, el('span', {}, it.label)),
      it.link && el('a', { href: it.link, target: '_blank', rel: 'noopener', class: 'consent-view' }, '보기'),
      it.summary && el('ul', { class: 'consent-summary' }, ...it.summary.map((s) => el('li', {}, s))),
    );
  });
  all.addEventListener('change', () => { Object.values(boxes).forEach((x) => { x.checked = all.checked; }); });

  const root = el('div', { class: 'consent' },
    el('label', { class: 'consent-label consent-all', for: all.id }, all, el('span', {}, '모두 동의해요')),
    ...rows,
  );
  root.isComplete = () => Object.values(boxes).every((x) => x.checked);
  return root;
}

// ------------------------------------------------------------------
// 약관 동의 화면 (이미 가입한 회원이 아직 동의하지 않은 경우, 로그인 후 한 번)
// ------------------------------------------------------------------
export function renderConsent() {
  const checklist = consentChecklist();
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '동의하고 계속하기');
  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      if (!checklist.isComplete()) return msg.show('필수 항목에 모두 동의해 주세요.');
      setBusy(submit, true, '저장하는 중…');
      const { data, error } = await sb.auth.updateUser({ data: consentRecord() });
      setBusy(submit, false);
      if (error) return msg.show(friendlyError(error));
      if (data?.user) state.session = { ...state.session, user: data.user };
      toast('고마워요! 이제 도란톡을 계속 쓸 수 있어요.');
      go(state.afterConsent || '/home', { replace: true });
      state.afterConsent = null;
    },
  },
    el('h1', {}, '약관에 동의해 주세요'),
    el('p', { class: 'muted' }, `${SERVICE_NAME}을 계속 쓰려면 이용약관과 개인정보처리방침에 동의가 필요해요. 한 번만 하면 돼요.`),
    checklist,
    msg,
    submit,
  );
  render(el('main', { class: 'page' },
    brandHeader(),
    form,
    el('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: async () => { await forgetThisDevice(); sb.auth.signOut(); } }, '나중에 하기 (로그아웃)'),
    el('p', { class: 'center small muted' },
      '동의하지 않으시면 ', el('a', { href: '#/me/delete' }, '회원 탈퇴'), '할 수 있어요.'),
  ));
}

// 화면 아래쪽 링크 묶음 (로그인 화면, 내 정보, 사용 방법)
export function legalLinks() {
  return el('p', { class: 'center small muted legal-links' },
    el('a', { href: '#/terms', class: 'muted' }, '이용약관'), ' · ',
    el('a', { href: '#/privacy', class: 'legal-privacy-link' }, '개인정보처리방침'), ' · ',
    el('a', { href: `mailto:${CONTACT_EMAIL}`, class: 'muted' }, '문의'),
  );
}
