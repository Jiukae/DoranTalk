// 소식(글 · 댓글 · 하트) 관련 서버 요청 모음
import { sb } from './supabase.js';
import { state } from './state.js';
import { removeImages } from './images.js';

export const PAGE_SIZE = 15;
export const MAX_IMAGES = 10;
export const MAX_POST_LENGTH = 5000;
export const MAX_COMMENT_LENGTH = 1000;

const POST_FIELDS = `
  id, group_id, author_id, content, image_paths, created_at, updated_at,
  author:profiles!posts_author_id_fkey(nickname),
  post_likes(user_id),
  comments(count)
`;

function check({ data, error }) {
  if (error) throw error;
  return data;
}

function shapePost(p) {
  const me = state.session.user.id;
  return {
    ...p,
    nickname: p.author?.nickname ?? '(알 수 없음)',
    likeCount: p.post_likes?.length ?? 0,
    likedByMe: (p.post_likes || []).some((l) => l.user_id === me),
    commentCount: p.comments?.[0]?.count ?? 0,
    isMine: p.author_id === me,
    edited: new Date(p.updated_at) - new Date(p.created_at) > 60000,
  };
}

// 최신 글부터 PAGE_SIZE 개. before(작성 시각)를 주면 그보다 예전 글.
export async function fetchPosts(groupId, before = null) {
  let query = sb.from('posts').select(POST_FIELDS)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (before) query = query.lt('created_at', before);
  return check(await query).map(shapePost);
}

export async function fetchPost(postId) {
  const row = check(await sb.from('posts').select(POST_FIELDS).eq('id', postId).maybeSingle());
  return row ? shapePost(row) : null;
}

export async function createPost(groupId, content, imagePaths) {
  return check(await sb.from('posts')
    .insert({ group_id: groupId, content, image_paths: imagePaths })
    .select('id')
    .single());
}

export async function updatePost(postId, content, imagePaths) {
  return check(await sb.from('posts')
    .update({ content, image_paths: imagePaths })
    .eq('id', postId)
    .select('id')
    .single());
}

// 글을 지우고, 그 글의 사진도 창고에서 지워요
export async function deletePost(post) {
  check(await sb.from('posts').delete().eq('id', post.id));
  await removeImages(post.image_paths);
}

export async function setLike(postId, liked) {
  if (liked) {
    const { error } = await sb.from('post_likes').insert({ post_id: postId });
    if (error && error.code !== '23505') throw error; // 이미 눌렀으면 괜찮음
  } else {
    check(await sb.from('post_likes').delete()
      .eq('post_id', postId)
      .eq('user_id', state.session.user.id));
  }
}

// 하트 누른 사람들 닉네임
export async function fetchLikers(postId) {
  const rows = check(await sb.from('post_likes')
    .select('user_id, created_at, profile:profiles!post_likes_user_id_fkey(nickname)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true }));
  return rows.map((r) => r.profile?.nickname ?? '(알 수 없음)');
}

export async function fetchComments(postId) {
  const me = state.session.user.id;
  const rows = check(await sb.from('comments')
    .select('id, post_id, author_id, content, created_at, updated_at, author:profiles!comments_author_id_fkey(nickname)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true }));
  return rows.map((c) => ({
    ...c,
    nickname: c.author?.nickname ?? '(알 수 없음)',
    isMine: c.author_id === me,
    edited: new Date(c.updated_at) - new Date(c.created_at) > 60000,
  }));
}

export async function addComment(postId, content) {
  return check(await sb.from('comments').insert({ post_id: postId, content }).select('id').single());
}

export async function updateComment(commentId, content) {
  return check(await sb.from('comments').update({ content }).eq('id', commentId).select('id').single());
}

export async function deleteComment(commentId) {
  return check(await sb.from('comments').delete().eq('id', commentId));
}

// 이 그룹에 새 글이 올라오면 알려 줘요 (보안 규칙상 그룹 멤버에게만 전달)
export function watchPosts(groupId, onChange) {
  const channel = sb.channel(`posts-${groupId}-${Date.now()}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'posts', filter: `group_id=eq.${groupId}` },
      (payload) => onChange(payload))
    .subscribe();
  return () => sb.removeChannel(channel);
}

export function watchComments(postId, onChange) {
  const channel = sb.channel(`comments-${postId}-${Date.now()}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` },
      () => onChange())
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'post_likes', filter: `post_id=eq.${postId}` },
      () => onChange())
    .subscribe();
  return () => sb.removeChannel(channel);
}
