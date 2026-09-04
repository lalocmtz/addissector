// The roles a creative team has. `ai` is the assistant as a member: it can own work too.
export const MEMBER_ROLES = ['strategist', 'image_editor', 'video_editor', 'ugc_creator', 'media_buyer', 'designer', 'editor', 'ai', 'other'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
