// 소식(피드) 화면: 목록 · 글쓰기/수정 · 글 상세(댓글)
import { state } from '../state.js';
import { go, navToken, isStale } from '../router.js';
import { friendlyError } from '../errors.js';
import {
  el, render, appBar, backButton, messageBox, setBusy, toast, avatar, emptyState, errorCard, loadingScreen,
  icon, iconTile, confirmDialog, actionSheet, skeletonPosts,
} from '../ui.js';
import { timeAgo } from '../format.js';
import { fetchGroup } from '../groups.js';
import {
  fetchPosts, fetchPost, createPost, updatePost, deletePost, setLike, fetchLikers,
  fetchComments, addComment, updateComment, deleteComment, watchPosts, watchComments,
  PAGE_SIZE, MAX_IMAGES, MAX_POST_LENGTH, MAX_COMMENT_LENGTH,
} from '../feed.js';
import { pickImages, shrinkImage, uploadImages, removeImages, signedUrls } from '../images.js';
import { openLightbox } from '../lightbox.js';
import { notifyFamily } from '../push.js';

const GRID_LIMIT = 4; // 목록에서는 사진 4장까지만 보이고 "+N"

// ------------------------------------------------------------------
// 공통 조각
// ------------------------------------------------------------------
function photoGrid(paths, urls, { stacked = false } = {}) {
  if (!paths?.length) return null;
  const all = paths.map((p) => urls[p]).filter(Boolean);
  const shown = stacked ? paths : paths.slice(0, GRID_LIMIT);
  const extra = paths.length - shown.length;
  const cls = stacked ? 'photos photos-stacked' : `photos photos-${Math.min(shown.length, 4)}`;
  return el('div', { class: cls },
    ...shown.map((p, i) => {
      const url = urls[p];
      const btn = el('button', {
        class: 'photo', type: 'button', 'aria-label': `사진 ${i + 1} 크게 보기`,
        onclick: () => { if (all.length) openLightbox(all, Math.max(0, all.indexOf(url))); },
      },
        url
          ? el('img', {
            src: url, alt: '', loading: 'lazy', decoding: 'async',
            // 주소가 만료되었거나 사진이 지워졌으면 안내 문구로 바꿔요
            onerror: (e) => e.target.replaceWith(el('span', { class: 'photo-missing' }, '사진을 불러올 수 없어요')),
          })
          : el('span', { class: 'photo-missing' }, '사진을 불러올 수 없어요'),
        !stacked && i === shown.length - 1 && extra > 0 && el('span', { class: 'photo-more' }, `+${extra}`),
      );
      return btn;
    }),
  );
}

function likeButton(post, onChange = () => {}) {
  const heart = el('span', { class: 'like-icon', 'aria-hidden': 'true' });
  const label = el('span', {});
  const btn = el('button', { class: 'action', type: 'button' }, heart, label);
  const paint = () => {
    heart.replaceChildren(icon('heart', { size: 24, filled: post.likedByMe }));
    label.textContent = post.likeCount ? `하트 ${post.likeCount}` : '하트';
    btn.classList.toggle('liked', post.likedByMe);
    btn.setAttribute('aria-pressed', String(post.likedByMe));
  };
  btn.addEventListener('click', async () => {
    const before = { liked: post.likedByMe, count: post.likeCount };
    post.likedByMe = !before.liked;
    post.likeCount += post.likedByMe ? 1 : -1;
    paint();
    btn.disabled = true;
    try {
      await setLike(post.id, post.likedByMe);
      onChange();
    } catch (err) {
      post.likedByMe = before.liked;
      post.likeCount = before.count;
      paint();
      toast(friendlyError(err), 4000);
    } finally {
      btn.disabled = false;
    }
  });
  paint();
  return btn;
}

// 내 글의 "⋯" 메뉴: 아래에서 올라오는 메뉴(수정하기 / 삭제하기)
function ownerMenu(onEdit, onDelete, what = '글') {
  const toggle = el('button', {
    class: 'more-btn', type: 'button', 'aria-label': `내 ${what} 수정·삭제 메뉴`, 'aria-haspopup': 'dialog',
    onclick: () => actionSheet({
      title: `내 ${what}`,
      actions: [
        { label: `${what} 수정`, icon: 'edit', onSelect: onEdit },
        { label: `${what} 삭제`, icon: 'trash', danger: true, onSelect: onDelete },
      ],
    }),
  }, icon('more', { size: 26 }));
  return { toggle };
}

async function confirmDeletePost(post) {
  const ok = await confirmDialog({
    title: '이 글을 삭제할까요?', message: '사진과 댓글도 함께 지워지고, 되돌릴 수 없어요.',
    confirmText: '삭제', danger: true,
  });
  if (!ok) return false;
  try {
    await deletePost(post);
    toast('글을 삭제했어요.');
    return true;
  } catch (err) {
    toast(friendlyError(err), 4000);
    return false;
  }
}

function postHeader(post, menu) {
  return el('header', { class: 'post-head' },
    avatar(post.nickname),
    el('div', { class: 'post-meta' },
      el('p', { class: 'post-author' }, post.nickname),
      el('p', { class: 'post-time' }, timeAgo(post.created_at), post.edited ? ' · 수정됨' : ''),
    ),
    menu?.toggle,
  );
}

// ------------------------------------------------------------------
// 소식 목록 (그룹 화면의 "소식" 탭)
// ------------------------------------------------------------------
export async function renderFeedTab(main, group, token) {
  const list = el('div', { class: 'post-list' });
  const moreBtn = el('button', { class: 'btn btn-secondary btn-block', type: 'button', hidden: true }, '이전 소식 더 보기');
  const newPill = el('button', { class: 'new-pill', type: 'button', hidden: true }, icon('arrowUp', { size: 20 }), '새 소식이 있어요');
  let oldest = null;

  list.append(skeletonPosts(2));
  main.append(composePrompt(group.id), newPill, list, moreBtn);

  async function loadPage(reset) {
    if (reset) {
      oldest = null;
      newPill.hidden = true;
    }
    let posts;
    try {
      posts = await fetchPosts(group.id, oldest);
    } catch (err) {
      if (!isStale(token)) list.replaceChildren(errorCard(friendlyError(err), () => loadPage(true)));
      return;
    }
    if (isStale(token)) return;
    const urls = await signedUrls(posts.flatMap((p) => p.image_paths.slice(0, GRID_LIMIT))).catch(() => ({}));
    if (isStale(token)) return;

    const cards = posts.map((p) => feedCard(p, urls, group.id));
    if (reset) list.replaceChildren(...cards);
    else list.append(...cards);
    if (posts.length) oldest = posts[posts.length - 1].created_at;
    moreBtn.hidden = posts.length < PAGE_SIZE;

    if (reset && posts.length === 0) {
      list.replaceChildren(el('section', { class: 'card' },
        emptyState('sparkles', '아직 소식이 없어요', '위의 칸을 눌러 가족에게 첫 소식을 전해 보세요!')));
    }
  }

  moreBtn.addEventListener('click', async () => {
    setBusy(moreBtn, true, '불러오는 중…');
    await loadPage(false);
    setBusy(moreBtn, false);
  });
  newPill.addEventListener('click', async () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await loadPage(true);
  });

  await loadPage(true);

  // 다른 가족이 새 글을 올리면 알려 주기
  const stopWatching = watchPosts(group.id, (payload) => {
    if (payload.eventType === 'INSERT' && payload.new?.author_id !== state.session.user.id) newPill.hidden = false;
  });
  // 앱으로 돌아왔을 때: 맨 위를 보고 있으면 새로고침, 아니면 알림만
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (window.scrollY < 200) loadPage(true);
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopWatching();
    document.removeEventListener('visibilitychange', onVisible);
  };
}

function composePrompt(groupId) {
  return el('a', { href: `#/group/${groupId}/write`, class: 'card compose-prompt' },
    avatar(state.profile?.nickname),
    el('span', { class: 'compose-fake-input' }, '소식을 남겨 보세요'),
    el('span', { class: 'compose-photo' }, iconTile('image')),
  );
}

function feedCard(post, urls, groupId) {
  const detailHref = `#/group/${groupId}/post/${post.id}`;
  let menu = null;
  const card = el('article', { class: 'card post' });
  if (post.isMine) {
    menu = ownerMenu(
      () => go(`/group/${groupId}/post/${post.id}/edit`),
      async () => { if (await confirmDeletePost(post)) card.remove(); },
    );
  }
  const text = post.content
    ? el('p', { class: 'post-text clamp' }, post.content)
    : null;
  const long = post.content && (post.content.length > 300 || post.content.split('\n').length > 8);

  card.append(
    postHeader(post, menu),
    text || '',
    long ? el('a', { href: detailHref, class: 'read-more' }, '…더 보기') : '',
    photoGrid(post.image_paths, urls) || '',
    el('footer', { class: 'post-actions' },
      likeButton(post),
      el('a', { href: detailHref, class: 'action' },
        icon('comment', { size: 23 }),
        post.commentCount ? `댓글 ${post.commentCount}` : '댓글 쓰기'),
    ),
  );
  return card;
}

// ------------------------------------------------------------------
// 글쓰기 / 글 수정
// ------------------------------------------------------------------
export async function renderWrite({ id: groupId, postId }) {
  const token = navToken();
  const editing = Boolean(postId);
  render(appBar(editing ? '글 수정' : '새 소식'), loadingScreen());

  let group;
  let post = null;
  try {
    [group, post] = await Promise.all([fetchGroup(groupId), editing ? fetchPost(postId) : null]);
  } catch (err) {
    if (!isStale(token)) {
      render(appBar('', { left: backButton(() => go(`/group/${groupId}/feed`)) }),
        el('main', { class: 'page' }, errorCard(friendlyError(err), () => renderWrite({ id: groupId, postId }))));
    }
    return;
  }
  if (isStale(token)) return;
  if (!group || (editing && (!post || !post.isMine))) {
    render(appBar('', { left: backButton(() => go('/home'), '목록') }),
      el('main', { class: 'page' }, el('section', { class: 'card' },
        emptyState('lock', editing ? '이 글은 수정할 수 없어요' : '이 그룹에 글을 쓸 수 없어요',
          editing ? '내가 쓴 글만 수정할 수 있어요.' : '그룹 멤버만 글을 쓸 수 있어요.'))));
    return;
  }

  // 사진 목록: 이미 올린 사진 { path } 와 새로 고른 사진 { blob, preview }
  const photos = (post?.image_paths || []).map((path) => ({ path }));
  const existingUrls = await signedUrls(post?.image_paths || []).catch(() => ({}));
  if (isStale(token)) return;
  const originalPaths = [...(post?.image_paths || [])];

  const textarea = el('textarea', {
    class: 'input textarea', rows: 7, maxlength: MAX_POST_LENGTH,
    placeholder: '가족에게 어떤 소식을 전할까요?\n(사진만 올려도 돼요)',
    'aria-label': '글 내용',
  });
  textarea.value = post?.content || '';
  const thumbs = el('div', { class: 'thumbs' });
  const addBtn = el('button', { class: 'btn btn-block add-photo', type: 'button' });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, editing ? '수정 완료' : '올리기');
  let dirty = false;
  textarea.addEventListener('input', () => { dirty = true; });

  const paintThumbs = () => {
    thumbs.replaceChildren(...photos.map((ph, i) => el('div', { class: 'thumb' },
      el('img', { src: ph.preview || existingUrls[ph.path] || '', alt: `사진 ${i + 1}` }),
      el('button', {
        class: 'thumb-remove', type: 'button', 'aria-label': `사진 ${i + 1} 빼기`,
        onclick: () => {
          const [removed] = photos.splice(i, 1);
          if (removed.preview) URL.revokeObjectURL(removed.preview);
          dirty = true;
          paintThumbs();
        },
      }, icon('close', { size: 18 })),
    )));
    addBtn.replaceChildren(icon('camera', { size: 22 }), `사진 추가 (${photos.length}/${MAX_IMAGES})`);
    addBtn.disabled = photos.length >= MAX_IMAGES;
  };

  addBtn.addEventListener('click', async () => {
    const files = await pickImages();
    if (!files.length) return;
    const room = MAX_IMAGES - photos.length;
    if (files.length > room) toast(`사진은 한 글에 ${MAX_IMAGES}장까지 올릴 수 있어요. 앞의 ${room}장만 넣을게요.`, 4000);
    setBusy(addBtn, true, '사진 준비 중…');
    for (const file of files.slice(0, room)) {
      try {
        const blob = await shrinkImage(file);
        photos.push({ blob, preview: URL.createObjectURL(blob) });
        dirty = true;
      } catch (err) {
        toast(err.message, 4000);
      }
    }
    setBusy(addBtn, false);
    paintThumbs();
  });

  const backToFeed = () => go(editing ? `/group/${groupId}/post/${postId}` : `/group/${groupId}/feed`);
  const cancel = async () => {
    if (dirty && !(await confirmDialog({ title: '쓰던 글을 버릴까요?', message: '작성 중인 내용이 사라져요.', confirmText: '나가기', cancelText: '계속 쓰기' }))) return;
    backToFeed();
  };

  const form = el('form', {
    class: 'card write-card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const content = textarea.value.trim();
      if (!content && photos.length === 0) return msg.show('글을 쓰거나 사진을 한 장 이상 넣어 주세요.');

      const newOnes = photos.filter((p) => p.blob);
      setBusy(submit, true, '올리는 중…');
      addBtn.disabled = true;
      let uploaded = [];
      try {
        uploaded = await uploadImages(groupId, 'posts', newOnes.map((p) => p.blob), (n, total) => {
          submit.lastChild.textContent = `사진 올리는 중 (${n}/${total})…`;
        });
        newOnes.forEach((p, i) => { p.path = uploaded[i]; });
        const finalPaths = photos.map((p) => p.path);
        submit.lastChild.textContent = '저장하는 중…';

        if (editing) {
          await updatePost(postId, content, finalPaths);
          await removeImages(originalPaths.filter((p) => !finalPaths.includes(p)));
          toast('글을 수정했어요.');
          go(`/group/${groupId}/post/${postId}`, { replace: true });
        } else {
          const created = await createPost(groupId, content, finalPaths);
          notifyFamily('post', created.id); // 가족 휴대폰으로 알림
          toast('소식을 올렸어요! 🎉');
          go(`/group/${groupId}/feed`, { replace: true });
        }
        photos.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      } catch (err) {
        // 글 저장에 실패하면 방금 올린 사진은 정리
        await removeImages(uploaded);
        newOnes.forEach((p) => { delete p.path; });
        msg.show(friendlyError(err));
        setBusy(submit, false);
        paintThumbs();
      }
    },
  },
    el('div', { class: 'write-head' },
      avatar(state.profile?.nickname),
      el('p', {}, state.profile?.nickname || ''),
    ),
    textarea,
    thumbs,
    addBtn,
    el('p', { class: 'hint', style: 'margin:8px 0 16px' }, `사진은 한 번에 ${MAX_IMAGES}장까지 넣을 수 있어요.`),
    msg,
    submit,
  );

  paintThumbs();
  render(
    appBar(editing ? '글 수정' : `${group.name}에 새 소식`, { left: backButton(cancel, '취소') }),
    el('main', { class: 'page' }, form),
  );
  if (!editing) textarea.focus();
}

// ------------------------------------------------------------------
// 글 상세: 글 전체 + 사진 전부 + 하트 누른 사람 + 댓글
// ------------------------------------------------------------------
export async function renderPostDetail({ id: groupId, postId }) {
  const token = navToken();
  const back = backButton(() => go(`/group/${groupId}/feed`), '소식');
  render(appBar('글 보기', { left: back }), loadingScreen());

  const main = el('main', { class: 'page page-with-composer' });
  const postBox = el('div', {});
  const likersLine = el('p', { class: 'likers' });
  const commentsBox = el('section', { class: 'card comments' });
  const composer = commentComposer(postId, () => refreshComments(true));

  async function refreshPost() {
    let post;
    try {
      post = await fetchPost(postId);
    } catch (err) {
      if (!isStale(token)) postBox.replaceChildren(errorCard(friendlyError(err), refreshPost));
      return null;
    }
    if (isStale(token)) return null;
    if (!post) {
      render(appBar('글 보기', { left: back }),
        el('main', { class: 'page' }, el('section', { class: 'card' },
          emptyState('search', '글을 찾을 수 없어요', '지워진 글이거나, 볼 수 없는 그룹의 글이에요.'),
          el('a', { href: `#/group/${groupId}/feed`, class: 'btn btn-block' }, '소식으로'))));
      return null;
    }
    const urls = await signedUrls(post.image_paths).catch(() => ({}));
    if (isStale(token)) return null;

    let menu = null;
    if (post.isMine) {
      menu = ownerMenu(
        () => go(`/group/${groupId}/post/${post.id}/edit`),
        async () => { if (await confirmDeletePost(post)) go(`/group/${groupId}/feed`, { replace: true }); },
      );
    }
    postBox.replaceChildren(el('article', { class: 'card post' },
      postHeader(post, menu),
      post.content ? el('p', { class: 'post-text' }, post.content) : '',
      photoGrid(post.image_paths, urls, { stacked: true }) || '',
      el('footer', { class: 'post-actions' }, likeButton(post, refreshLikers)),
      likersLine,
    ));
    refreshLikers();
    return post;
  }

  async function refreshLikers() {
    const names = await fetchLikers(postId).catch(() => []);
    if (isStale(token)) return;
    likersLine.replaceChildren(...(names.length
      ? [icon('heart', { size: 18, filled: true }), `${names.join(', ')}님이 좋아해요`]
      : []));
  }

  async function refreshComments(scrollToEnd = false) {
    let comments;
    try {
      comments = await fetchComments(postId);
    } catch (err) {
      if (!isStale(token)) commentsBox.replaceChildren(errorCard(friendlyError(err), () => refreshComments()));
      return;
    }
    if (isStale(token)) return;
    commentsBox.replaceChildren(
      el('h2', {}, comments.length ? `댓글 ${comments.length}개` : '댓글'),
      comments.length
        ? el('ul', { class: 'comment-list' }, ...comments.map((c) => commentItem(c, refreshComments)))
        : el('p', { class: 'muted' }, '첫 댓글을 남겨 보세요.'),
    );
    if (scrollToEnd) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  const post = await refreshPost();
  if (!post) return undefined;
  main.append(postBox, commentsBox, composer);
  render(appBar('글 보기', { left: back }), main);
  await refreshComments();

  // 다른 가족이 댓글이나 하트를 남기면 바로 반영
  return watchComments(postId, () => {
    refreshComments();
    refreshLikers();
  });
}

function commentItem(c, refresh) {
  const text = el('p', { class: 'comment-text' }, c.content);
  const li = el('li', { class: 'comment' },
    avatar(c.nickname, 'avatar-sm'),
    el('div', { class: 'comment-body' },
      el('p', { class: 'comment-meta' },
        el('strong', {}, c.nickname), ` · ${timeAgo(c.created_at)}`, c.edited ? ' · 수정됨' : ''),
      text,
      c.isMine && el('div', { class: 'comment-tools' },
        el('button', { class: 'link-btn', type: 'button', onclick: () => startEdit() }, '수정'),
        el('button', {
          class: 'link-btn danger', type: 'button',
          onclick: async () => {
            if (!(await confirmDialog({ title: '이 댓글을 삭제할까요?', confirmText: '삭제', danger: true }))) return;
            try {
              await deleteComment(c.id);
              toast('댓글을 삭제했어요.');
              refresh();
            } catch (err) {
              toast(friendlyError(err), 4000);
            }
          },
        }, '삭제'),
      ),
    ),
  );

  function startEdit() {
    const box = el('textarea', { class: 'input textarea', rows: 3, maxlength: MAX_COMMENT_LENGTH, 'aria-label': '댓글 고치기' });
    box.value = c.content;
    const save = el('button', { class: 'btn btn-small', type: 'button' }, '저장');
    const cancel = el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => refresh() }, '취소');
    save.addEventListener('click', async () => {
      const value = box.value.trim();
      if (!value) return toast('댓글 내용을 입력해 주세요.');
      setBusy(save, true, '');
      try {
        await updateComment(c.id, value);
        toast('댓글을 수정했어요.');
        refresh();
      } catch (err) {
        setBusy(save, false);
        toast(friendlyError(err), 4000);
      }
    });
    const body = li.querySelector('.comment-body');
    body.replaceChildren(body.firstChild, box, el('div', { class: 'comment-tools' }, save, cancel));
    box.focus();
  }
  return li;
}

function commentComposer(postId, onAdded) {
  const box = el('textarea', {
    class: 'input textarea composer-input', rows: 1, maxlength: MAX_COMMENT_LENGTH,
    placeholder: '댓글을 입력하세요', 'aria-label': '댓글 입력',
  });
  const send = el('button', { class: 'btn composer-send', type: 'button' }, '등록');
  // 글이 길어지면 입력칸도 자동으로 커지게 (최대 5줄)
  box.addEventListener('input', () => {
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  });
  send.addEventListener('click', async () => {
    const value = box.value.trim();
    if (!value) {
      box.focus();
      return;
    }
    setBusy(send, true, '');
    try {
      const created = await addComment(postId, value);
      notifyFamily('comment', created.id); // 글쓴이와 댓글 단 가족에게 알림
      box.value = '';
      box.style.height = 'auto';
      onAdded();
    } catch (err) {
      toast(friendlyError(err), 4000);
    } finally {
      setBusy(send, false);
    }
  });
  return el('div', { class: 'composer' }, el('div', { class: 'composer-inner' }, box, send));
}
