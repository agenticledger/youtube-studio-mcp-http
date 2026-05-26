/**
 * YouTube Studio API Client
 *
 * Refresh-token-based auth (matches Gmail MCP pattern).
 * Constructor takes (refreshToken, clientId, clientSecret).
 * Auto-exchanges for access tokens with caching.
 */

import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class YouTubeStudioClient {
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;
  private cachedAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(refreshToken: string, clientId: string, clientSecret: string) {
    this.refreshToken = refreshToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.cachedAccessToken;
    }
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }
    const data = await response.json() as any;
    this.cachedAccessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    return this.cachedAccessToken!;
  }

  private async getYouTube(): Promise<youtube_v3.Youtube> {
    const accessToken = await this.getAccessToken();
    const auth = new OAuth2Client();
    auth.setCredentials({ access_token: accessToken });
    return google.youtube({ version: 'v3', auth });
  }

  // ─── Video Management ───────────────────────────────────────────────

  async listVideos(maxResults = 25, pageToken?: string) {
    const yt = await this.getYouTube();
    const res = await yt.search.list({
      part: ['snippet'],
      forMine: true,
      type: ['video'],
      maxResults,
      pageToken,
    });
    return {
      videos: res.data.items || [],
      nextPageToken: res.data.nextPageToken,
      totalResults: res.data.pageInfo?.totalResults,
    };
  }

  async getVideo(videoId: string) {
    const yt = await this.getYouTube();
    const res = await yt.videos.list({
      part: ['snippet', 'statistics', 'status', 'contentDetails'],
      id: [videoId],
    });
    const video = res.data.items?.[0];
    if (!video) throw new Error(`Video not found: ${videoId}`);
    return video;
  }

  async uploadVideo(
    options: {
      title: string;
      description?: string;
      tags?: string[];
      categoryId?: string;
      privacyStatus?: string;
      filePath?: string;
      url?: string;
    }
  ) {
    const yt = await this.getYouTube();

    // For file upload, we need a readable stream
    if (!options.filePath) {
      throw new Error('filePath is required for video upload');
    }

    const fs = await import('fs');
    const stream = fs.createReadStream(options.filePath);

    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: options.title,
          description: options.description || '',
          tags: options.tags || [],
          categoryId: options.categoryId || '22', // People & Blogs
        },
        status: {
          privacyStatus: options.privacyStatus || 'private',
        },
      },
      media: {
        body: stream,
      },
    });

    return res.data;
  }

  async updateVideo(
    videoId: string,
    updates: {
      title?: string;
      description?: string;
      tags?: string[];
      categoryId?: string;
      privacyStatus?: string;
    }
  ) {
    const yt = await this.getYouTube();

    // First get current video data
    const current = await this.getVideo(videoId);

    const snippet: any = {
      ...current.snippet,
      ...(updates.title && { title: updates.title }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.tags && { tags: updates.tags }),
      ...(updates.categoryId && { categoryId: updates.categoryId }),
    };

    const requestBody: any = {
      id: videoId,
      snippet,
    };

    const parts: string[] = ['snippet'];

    if (updates.privacyStatus) {
      requestBody.status = { privacyStatus: updates.privacyStatus };
      parts.push('status');
    }

    const res = await yt.videos.update({
      part: parts,
      requestBody,
    });

    return res.data;
  }

  async deleteVideo(videoId: string) {
    const yt = await this.getYouTube();
    await yt.videos.delete({ id: videoId });
    return { deleted: true, videoId };
  }

  async setThumbnail(videoId: string, filePath: string) {
    const yt = await this.getYouTube();
    const fs = await import('fs');
    const stream = fs.createReadStream(filePath);

    const res = await yt.thumbnails.set({
      videoId,
      media: {
        body: stream,
      },
    });

    return res.data;
  }

  // ─── Playlist Management ────────────────────────────────────────────

  async listPlaylists(maxResults = 25, pageToken?: string) {
    const yt = await this.getYouTube();
    const res = await yt.playlists.list({
      part: ['snippet', 'contentDetails', 'status'],
      mine: true,
      maxResults,
      pageToken,
    });
    return {
      playlists: res.data.items || [],
      nextPageToken: res.data.nextPageToken,
      totalResults: res.data.pageInfo?.totalResults,
    };
  }

  async createPlaylist(
    title: string,
    description?: string,
    privacyStatus = 'private'
  ) {
    const yt = await this.getYouTube();
    const res = await yt.playlists.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description: description || '' },
        status: { privacyStatus },
      },
    });
    return res.data;
  }

  async updatePlaylist(
    playlistId: string,
    updates: { title?: string; description?: string; privacyStatus?: string }
  ) {
    const yt = await this.getYouTube();

    // Get current playlist data
    const current = await yt.playlists.list({
      part: ['snippet', 'status'],
      id: [playlistId],
    });
    const playlist = current.data.items?.[0];
    if (!playlist) throw new Error(`Playlist not found: ${playlistId}`);

    const parts: string[] = ['snippet'];
    const requestBody: any = {
      id: playlistId,
      snippet: {
        ...playlist.snippet,
        ...(updates.title && { title: updates.title }),
        ...(updates.description !== undefined && { description: updates.description }),
      },
    };

    if (updates.privacyStatus) {
      requestBody.status = { privacyStatus: updates.privacyStatus };
      parts.push('status');
    }

    const res = await yt.playlists.update({ part: parts, requestBody });
    return res.data;
  }

  async deletePlaylist(playlistId: string) {
    const yt = await this.getYouTube();
    await yt.playlists.delete({ id: playlistId });
    return { deleted: true, playlistId };
  }

  async addToPlaylist(playlistId: string, videoId: string, position?: number) {
    const yt = await this.getYouTube();
    const res = await yt.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          playlistId,
          resourceId: { kind: 'youtube#video', videoId },
          ...(position !== undefined && { position }),
        },
      },
    });
    return res.data;
  }

  async removeFromPlaylist(playlistItemId: string) {
    const yt = await this.getYouTube();
    await yt.playlistItems.delete({ id: playlistItemId });
    return { deleted: true, playlistItemId };
  }

  // ─── Channel & Analytics ────────────────────────────────────────────

  async getChannel() {
    const yt = await this.getYouTube();
    const res = await yt.channels.list({
      part: ['snippet', 'statistics', 'contentDetails', 'brandingSettings'],
      mine: true,
    });
    const channel = res.data.items?.[0];
    if (!channel) throw new Error('No channel found for authenticated user');
    return channel;
  }

  async getAnalytics(
    options: {
      startDate: string;
      endDate: string;
      metrics?: string;
      dimensions?: string;
      videoId?: string;
    }
  ) {
    const accessToken = await this.getAccessToken();
    const auth = new OAuth2Client();
    auth.setCredentials({ access_token: accessToken });
    const ytAnalytics = google.youtubeAnalytics({ version: 'v2', auth });

    const params: any = {
      ids: 'channel==MINE',
      startDate: options.startDate,
      endDate: options.endDate,
      metrics: options.metrics || 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
    };

    if (options.dimensions) params.dimensions = options.dimensions;
    if (options.videoId) params.filters = `video==${options.videoId}`;

    const res = await ytAnalytics.reports.query(params);
    return res.data;
  }

  // ─── Comments ───────────────────────────────────────────────────────

  async listComments(videoId: string, maxResults = 20, pageToken?: string) {
    const yt = await this.getYouTube();
    const res = await yt.commentThreads.list({
      part: ['snippet', 'replies'],
      videoId,
      maxResults,
      pageToken,
      order: 'time',
    });
    return {
      comments: res.data.items || [],
      nextPageToken: res.data.nextPageToken,
      totalResults: res.data.pageInfo?.totalResults,
    };
  }

  async replyToComment(parentId: string, text: string) {
    const yt = await this.getYouTube();
    const res = await yt.comments.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          parentId,
          textOriginal: text,
        },
      },
    });
    return res.data;
  }

  async deleteComment(commentId: string) {
    const yt = await this.getYouTube();
    await yt.comments.delete({ id: commentId });
    return { deleted: true, commentId };
  }

  async moderateComment(
    commentId: string,
    moderationStatus: 'published' | 'heldForReview' | 'rejected'
  ) {
    const yt = await this.getYouTube();
    await yt.comments.setModerationStatus({
      id: [commentId],
      moderationStatus,
    });
    return { moderated: true, commentId, moderationStatus };
  }

  // ─── Search ─────────────────────────────────────────────────────────

  async search(
    query: string,
    options: {
      type?: string;
      maxResults?: number;
      pageToken?: string;
      channelId?: string;
      order?: string;
    } = {}
  ) {
    const yt = await this.getYouTube();
    const res = await yt.search.list({
      part: ['snippet'],
      q: query,
      type: [options.type || 'video'],
      maxResults: options.maxResults || 25,
      pageToken: options.pageToken,
      channelId: options.channelId,
      order: options.order || 'relevance',
    });
    return {
      results: res.data.items || [],
      nextPageToken: res.data.nextPageToken,
      totalResults: res.data.pageInfo?.totalResults,
    };
  }
}
