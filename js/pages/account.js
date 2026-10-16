// 회원 탈퇴 화면 (#/me/delete)
// 순서: ① 내가 올린 사진 파일 지우기 → ② 계정 삭제(글·댓글·하트·채팅·멤버 기록이 함께 삭제) → ③ 로그아웃
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { friendlyError } from '../errors.js';
import { el, render, appBar, backButton, messageBox, setBusy, toast, confirmDialog } from '../ui.js';
import { BUCKET } from '../images.js';
import { CONTACT_EMAIL } from '../legal.js';

async function removeMyPhotos(onProgress) {
  const { data, error } = await sb.rpc('my_photo_paths');
  if (error) throw error;
  const paths = data || [];
  for (let i = 0; i < paths.length; i += 100) {
    onProgress(Math.min(i + 100, paths.length), paths.length);
    const { error: removeError } = await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (removeError) throw removeError;
  }
}

export function renderDeleteAccount() {
  const nickname = state.profile?.nickname || '';
  const confirmBox = el('input', { type: 'checkbox', class: 'check-input', id: 'delete-confirm' });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-danger btn-block', type: 'submit' }, '회원 탈퇴하기');
  // 내가 보호자로 동의해 가입한 자녀 계정이 있으면 알려 줌 (자녀 계정은 자동으로 지워지지 않아요)
  const kidsNote = el('p', { class: 'form-msg info', hidden: true });
  sb.rpc('my_children').then(({ data }) => {
    if (!data?.length) return;
    kidsNote.textContent = `보호자로 동의한 자녀 계정(${data.map((k) => k.nickname).join(', ')})은 그대로 남아요. 함께 지우려면 내 정보 → 자녀 계정에서 먼저 지워 주세요.`;
    kidsNote.hidden = false;
  });

  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      if (!confirmBox.checked) return msg.show('위 내용을 확인했다는 칸에 체크해 주세요.');
      const ok = await confirmDialog({
        title: '정말 탈퇴할까요?', message: '모든 글·사진·채팅이 지워지고 되돌릴 수 없어요.',
        confirmText: '탈퇴하기', danger: true,
      });
      if (!ok) return;

      setBusy(submit, true, '사진 지우는 중…');
      try {
        await removeMyPhotos((n, total) => { submit.lastChild.textContent = `사진 지우는 중 (${n}/${total})…`; });
        submit.lastChild.textContent = '계정 지우는 중…';
        const { error } = await sb.rpc('delete_my_account');
        if (error) throw error;
      } catch (err) {
        setBusy(submit, false);
        msg.show(`${friendlyError(err)} 문제가 계속되면 ${CONTACT_EMAIL} 으로 알려 주세요.`);
        return;
      }
      // 계정이 이미 지워졌으니 이 기기의 로그인 정보만 정리
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      state.session = null;
      state.profile = null;
      toast('탈퇴가 완료됐어요. 그동안 도란톡을 써 주셔서 고마워요.', 5000);
      go('/login', { replace: true });
    },
  },
    el('h1', {}, '회원 탈퇴'),
    el('p', {}, el('strong', {}, nickname), '님, 탈퇴하면 아래 정보가 ', el('strong', {}, '바로 삭제되고 되돌릴 수 없어요.')),
    el('ul', { class: 'bullets danger-list' },
      el('li', {}, '내 계정(이메일·닉네임)'),
      el('li', {}, '내가 쓴 글과 올린 사진, 댓글, 하트'),
      el('li', {}, '내가 보낸 채팅 메시지와 사진'),
      el('li', {}, '나 혼자 남아 있던 가족 그룹 (그룹 전체)'),
    ),
    el('p', { class: 'muted' }, '다른 가족이 있는 그룹은 그대로 남아요. 내가 방장이었다면 가장 먼저 들어온 가족이 방장이 돼요.'),
    el('p', { class: 'muted' }, '간직하고 싶은 사진은 탈퇴 전에 휴대폰에 저장해 두세요.'),
    kidsNote,
    el('label', { class: 'consent-label consent-all', for: confirmBox.id }, confirmBox, el('span', {}, '위 내용을 모두 확인했어요')),
    msg,
    submit,
  );

  render(
    appBar('회원 탈퇴', { left: backButton(() => go('/me')) }),
    el('main', { class: 'page' },
      form,
      el('a', { href: '#/me', class: 'btn btn-secondary btn-block' }, '탈퇴하지 않고 돌아가기'),
    ),
  );
}
