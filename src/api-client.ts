/**
 * YouTube Studio API Client
 *
 * Stateless client using googleapis + OAuth2Client.
 * Every method accepts an accessToken as the first param (per-call auth).
 */

import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class YouTubeStudioClient {
  private getYouTube(accessToken: string): youtube_v3.Youtube {
    const auth = new OAuth2Client();
    auth.setCredentials({ access_token: accessToken });
    return google.youtube({ version: 'v3', auth });
  }

  // ─── Video Management ───────────────────────────────────────────────

  async listVideos(accessToken: string, maxResults = 25, pageToken?: string) {
    const yt = this.getYouTube(accessToken);
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

  async getVideo(accessToken: string, videoId: string) {
    const yt = this.getYouTube(accessToken);
    const res = await yt.videos.list({
      part: ['snippet', 'statistics', 'status', 'contentDetails'],
      id: [videoId],
    });
    const video = res.data.items?.[0];
    if (!video) throw new Error(`Video not found: ${videoId}`);
    return video;
  }

  async uploadVideo(
    accessToken: string,
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
    const yt = this.getYouTube(accessToken);

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
    accessToken: string,
    videoId: string,
    updates: {
      title?: string;
      description?: string;
      tags?: string[];
      categoryId?: string;
      privacyStatus?: string;
    }
  ) {
    const yt = this.getYouTube(accessToken);

    // First get current video data
    const current = await this.getVideo(accessToken, videoId);

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

  async deleteVideo(accessToken: string, videoId: string) {
    const yt = this.getYouTube(accessToken);
    await yt.videos.delete({ id: videoId });
    return { deleted: true, videoId };
  }

  async setThumbnail(accessToken: string, videoId: string, filePath: string) {
    const yt = this.getYouTube(accessToken);
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

  async listPlaylists(accessToken: string, maxResults = 25, pageToken?: string) {
    const yt = this.getYouTube(accessToken);
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
    accessToken: string,
    title: string,
    description?: string,
    privacyStatus = 'private'
  ) {
    const yt = this.getYouTube(accessToken);
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
    accessToken: string,
    playlistId: string,
    updates: { title?: string; description?: string; privacyStatus?: string }
  ) {
    const yt = this.getYouTube(accessToken);

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

  async deletePlaylist(accessToken: string, playlistId: string) {
    const yt = this.getYouTube(accessToken);
    await yt.playlists.delete({ id: playlistId });
    return { deleted: true, playlistId };
  }

  async addToPlaylist(accessToken: string, playlistId: string, videoId: string, position?: number) {
    const yt = this.getYouTube(accessToken);
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

  async removeFromPlaylist(accessToken: string, playlistItemId: string) {
    const yt = this.getYouTube(accessToken);
    await yt.playlistItems.delete({ id: playlistItemId });
    return { deleted: true, playlistItemId };
  }

  // ─── Channel & Analytics ────────────────────────────────────────────

  async getChannel(accessToken: string) {
    const yt = this.getYouTube(accessToken);
    const res = await yt.channels.list({
      part: ['snippet', 'statistics', 'contentDetails', 'brandingSettings'],
      mine: true,
    });
    const channel = res.data.items?.[0];
    if (!channel) throw new Error('No channel found for authenticated user');
    return channel;
  }

  async getAnalytics(
    accessToken: string,
    options: {
      startDate: string;
      endDate: string;
      metrics?: string;
      dimensions?: string;
      videoId?: string;
    }
  ) {
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

  async listComments(accessToken: string, videoId: string, maxResults = 20, pageToken?: string) {
    const yt = this.getYouTube(accessToken);
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

  async replyToComment(accessToken: string, parentId: string, text: string) {
    const yt = this.getYouTube(accessToken);
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

  async deleteComment(accessToken: string, commentId: string) {
    const yt = this.getYouTube(accessToken);
    await yt.comments.delete({ id: commentId });
    return { deleted: true, commentId };
  }

  async moderateComment(
    accessToken: string,
    commentId: string,
    moderationStatus: 'published' | 'heldForReview' | 'rejected'
  ) {
    const yt = this.getYouTube(accessToken);
    await yt.comments.setModerationStatus({
      id: [commentId],
      moderationStatus,
    });
    return { moderated: true, commentId, moderationStatus };
  }

  // ─── Search ─────────────────────────────────────────────────────────

  async search(
    accessToken: string,
    query: string,
    options: {
      type?: string;
      maxResults?: number;
      pageToken?: string;
      channelId?: string;
      order?: string;
    } = {}
  ) {
    const yt = this.getYouTube(accessToken);
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
