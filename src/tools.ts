/**
 * YouTube Studio MCP Tools
 *
 * All tools use the youtube_studio_ prefix.
 * Auth is handled by the client (refresh-token-based) — no accessToken in schemas.
 */

import { z } from 'zod';
import { YouTubeStudioClient } from './api-client.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (client: YouTubeStudioClient, args: any) => Promise<any>;
}

export const tools: ToolDef[] = [
  // ─── Video Management ─────────────────────────────────────────────────

  {
    name: 'youtube_studio_list_videos',
    description: 'List videos on the authenticated YouTube channel with pagination',
    inputSchema: z.object({
      maxResults: z.number().optional().default(25).describe('Max videos to return (1-50)'),
      pageToken: z.string().optional().describe('Pagination token for next page'),
    }),
    handler: async (client, args) =>
      client.listVideos(args.maxResults, args.pageToken),
  },

  {
    name: 'youtube_studio_get_video',
    description: 'Get detailed info for a video including snippet, statistics, status, and content details',
    inputSchema: z.object({
      videoId: z.string().describe('YouTube video ID'),
    }),
    handler: async (client, args) => client.getVideo(args.videoId),
  },

  {
    name: 'youtube_studio_upload_video',
    description: 'Upload a video from a local file path to YouTube',
    inputSchema: z.object({
      filePath: z.string().describe('Local file path to the video file'),
      title: z.string().describe('Video title'),
      description: z.string().optional().describe('Video description'),
      tags: z.array(z.string()).optional().describe('Video tags'),
      categoryId: z.string().optional().describe('YouTube category ID (default: 22 = People & Blogs)'),
      privacyStatus: z
        .enum(['private', 'public', 'unlisted'])
        .optional()
        .default('private')
        .describe('Privacy status'),
    }),
    handler: async (client, args) =>
      client.uploadVideo({
        title: args.title,
        description: args.description,
        tags: args.tags,
        categoryId: args.categoryId,
        privacyStatus: args.privacyStatus,
        filePath: args.filePath,
      }),
  },

  {
    name: 'youtube_studio_update_video',
    description: 'Update a video\'s title, description, tags, category, or privacy status',
    inputSchema: z.object({
      videoId: z.string().describe('YouTube video ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      tags: z.array(z.string()).optional().describe('New tags'),
      categoryId: z.string().optional().describe('New category ID'),
      privacyStatus: z.enum(['private', 'public', 'unlisted']).optional().describe('New privacy status'),
    }),
    handler: async (client, args) =>
      client.updateVideo(args.videoId, {
        title: args.title,
        description: args.description,
        tags: args.tags,
        categoryId: args.categoryId,
        privacyStatus: args.privacyStatus,
      }),
  },

  {
    name: 'youtube_studio_delete_video',
    description: 'Permanently delete a video from the channel',
    inputSchema: z.object({
      videoId: z.string().describe('YouTube video ID to delete'),
    }),
    handler: async (client, args) => client.deleteVideo(args.videoId),
  },

  {
    name: 'youtube_studio_set_thumbnail',
    description: 'Set a custom thumbnail for a video from a local file path',
    inputSchema: z.object({
      videoId: z.string().describe('YouTube video ID'),
      filePath: z.string().describe('Local file path to the thumbnail image (JPEG, PNG, GIF, BMP)'),
    }),
    handler: async (client, args) =>
      client.setThumbnail(args.videoId, args.filePath),
  },

  // ─── Playlist Management ──────────────────────────────────────────────

  {
    name: 'youtube_studio_list_playlists',
    description: 'List playlists on the authenticated channel',
    inputSchema: z.object({
      maxResults: z.number().optional().default(25).describe('Max playlists to return (1-50)'),
      pageToken: z.string().optional().describe('Pagination token'),
    }),
    handler: async (client, args) =>
      client.listPlaylists(args.maxResults, args.pageToken),
  },

  {
    name: 'youtube_studio_create_playlist',
    description: 'Create a new playlist on the channel',
    inputSchema: z.object({
      title: z.string().describe('Playlist title'),
      description: z.string().optional().describe('Playlist description'),
      privacyStatus: z
        .enum(['private', 'public', 'unlisted'])
        .optional()
        .default('private')
        .describe('Privacy status'),
    }),
    handler: async (client, args) =>
      client.createPlaylist(args.title, args.description, args.privacyStatus),
  },

  {
    name: 'youtube_studio_update_playlist',
    description: 'Update a playlist\'s title, description, or privacy status',
    inputSchema: z.object({
      playlistId: z.string().describe('Playlist ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      privacyStatus: z.enum(['private', 'public', 'unlisted']).optional().describe('New privacy status'),
    }),
    handler: async (client, args) =>
      client.updatePlaylist(args.playlistId, {
        title: args.title,
        description: args.description,
        privacyStatus: args.privacyStatus,
      }),
  },

  {
    name: 'youtube_studio_delete_playlist',
    description: 'Delete a playlist from the channel',
    inputSchema: z.object({
      playlistId: z.string().describe('Playlist ID to delete'),
    }),
    handler: async (client, args) => client.deletePlaylist(args.playlistId),
  },

  {
    name: 'youtube_studio_add_to_playlist',
    description: 'Add a video to a playlist',
    inputSchema: z.object({
      playlistId: z.string().describe('Playlist ID'),
      videoId: z.string().describe('Video ID to add'),
      position: z.number().optional().describe('Position in playlist (0-based, omit for end)'),
    }),
    handler: async (client, args) =>
      client.addToPlaylist(args.playlistId, args.videoId, args.position),
  },

  {
    name: 'youtube_studio_remove_from_playlist',
    description: 'Remove a video from a playlist by playlist item ID',
    inputSchema: z.object({
      playlistItemId: z.string().describe('Playlist item ID (from list playlist items)'),
    }),
    handler: async (client, args) =>
      client.removeFromPlaylist(args.playlistItemId),
  },

  // ─── Channel & Analytics ──────────────────────────────────────────────

  {
    name: 'youtube_studio_get_channel',
    description: 'Get channel info and statistics for the authenticated user',
    inputSchema: z.object({}),
    handler: async (client, _args) => client.getChannel(),
  },

  {
    name: 'youtube_studio_get_analytics',
    description: 'Get channel or video analytics (views, watch time, subscribers gained, etc.)',
    inputSchema: z.object({
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
      metrics: z
        .string()
        .optional()
        .describe('Comma-separated metrics (default: views,estimatedMinutesWatched,averageViewDuration,subscribersGained)'),
      dimensions: z.string().optional().describe('Comma-separated dimensions (e.g. day, video, country)'),
      videoId: z.string().optional().describe('Filter to specific video ID'),
    }),
    handler: async (client, args) =>
      client.getAnalytics({
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: args.metrics,
        dimensions: args.dimensions,
        videoId: args.videoId,
      }),
  },

  // ─── Comments ─────────────────────────────────────────────────────────

  {
    name: 'youtube_studio_list_comments',
    description: 'List comment threads on a video',
    inputSchema: z.object({
      videoId: z.string().describe('Video ID to list comments for'),
      maxResults: z.number().optional().default(20).describe('Max comments to return (1-100)'),
      pageToken: z.string().optional().describe('Pagination token'),
    }),
    handler: async (client, args) =>
      client.listComments(args.videoId, args.maxResults, args.pageToken),
  },

  {
    name: 'youtube_studio_reply_to_comment',
    description: 'Reply to a comment on a video',
    inputSchema: z.object({
      parentId: z.string().describe('Parent comment ID to reply to'),
      text: z.string().describe('Reply text'),
    }),
    handler: async (client, args) =>
      client.replyToComment(args.parentId, args.text),
  },

  {
    name: 'youtube_studio_delete_comment',
    description: 'Delete a comment',
    inputSchema: z.object({
      commentId: z.string().describe('Comment ID to delete'),
    }),
    handler: async (client, args) => client.deleteComment(args.commentId),
  },

  {
    name: 'youtube_studio_moderate_comment',
    description: 'Set moderation status of a comment (published, heldForReview, rejected)',
    inputSchema: z.object({
      commentId: z.string().describe('Comment ID to moderate'),
      moderationStatus: z
        .enum(['published', 'heldForReview', 'rejected'])
        .describe('New moderation status'),
    }),
    handler: async (client, args) =>
      client.moderateComment(args.commentId, args.moderationStatus),
  },

  // ─── Search ───────────────────────────────────────────────────────────

  {
    name: 'youtube_studio_search',
    description: 'Search YouTube for videos, channels, or playlists',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      type: z.enum(['video', 'channel', 'playlist']).optional().default('video').describe('Result type'),
      maxResults: z.number().optional().default(25).describe('Max results (1-50)'),
      pageToken: z.string().optional().describe('Pagination token'),
      channelId: z.string().optional().describe('Filter to specific channel'),
      order: z
        .enum(['relevance', 'date', 'rating', 'viewCount', 'title'])
        .optional()
        .default('relevance')
        .describe('Sort order'),
    }),
    handler: async (client, args) =>
      client.search(args.query, {
        type: args.type,
        maxResults: args.maxResults,
        pageToken: args.pageToken,
        channelId: args.channelId,
        order: args.order,
      }),
  },
];
