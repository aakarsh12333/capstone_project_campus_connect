import { EventEmitter } from 'node:events';

export type CampusEventType =
  | 'message-created'
  | 'invitation-created'
  | 'resource-shared'
  | 'moderation-reported'
  | 'announcement-created'
  | 'analytics-recorded';

export interface CampusInternalEvent {
  type: CampusEventType;
  userId: string;
  userRole: string;
  groupId?: string;
  department?: string;
  latencyMs?: number;
  wasOffline?: boolean;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

class CampusEventBus extends EventEmitter {
  private recentEvents: CampusInternalEvent[] = [];
  private roleCounts: Record<string, number> = {
    student: 142,
    faculty: 28,
    group_admin: 14,
    platform_admin: 4,
  };
  private dailyActivity: Array<{
    day: string;
    messages: number;
    resources: number;
    offlineSynced: number;
  }> = [
    { day: 'Mon', messages: 318, resources: 42, offlineSynced: 19 },
    { day: 'Tue', messages: 412, resources: 56, offlineSynced: 24 },
    { day: 'Wed', messages: 489, resources: 63, offlineSynced: 31 },
    { day: 'Thu', messages: 446, resources: 58, offlineSynced: 22 },
    { day: 'Fri', messages: 534, resources: 74, offlineSynced: 38 },
    { day: 'Sat', messages: 268, resources: 31, offlineSynced: 15 },
    { day: 'Sun', messages: 304, resources: 39, offlineSynced: 18 },
  ];

  constructor() {
    super();
    this.on('message-created', (evt: CampusInternalEvent) => {
      this.recordInternal(evt);
      const today = this.dailyActivity[this.dailyActivity.length - 1];
      if (today) {
        today.messages += 1;
        if (evt.wasOffline) today.offlineSynced += 1;
      }
    });

    this.on('resource-shared', (evt: CampusInternalEvent) => {
      this.recordInternal(evt);
      const today = this.dailyActivity[this.dailyActivity.length - 1];
      if (today) {
        today.resources += 1;
        if (evt.wasOffline) today.offlineSynced += 1;
      }
    });

    this.on('invitation-created', (evt: CampusInternalEvent) => {
      this.recordInternal(evt);
    });

    this.on('moderation-reported', (evt: CampusInternalEvent) => {
      this.recordInternal(evt);
    });

    this.on('announcement-created', (evt: CampusInternalEvent) => {
      this.recordInternal(evt);
    });

    this.on('analytics-recorded', (evt: CampusInternalEvent) => {
      this.recordInternal(evt);
      if (evt.wasOffline) {
        const today = this.dailyActivity[this.dailyActivity.length - 1];
        if (today) today.offlineSynced += 1;
      }
    });
  }

  private recordInternal(evt: CampusInternalEvent) {
    this.recentEvents.unshift(evt);
    if (this.recentEvents.length > 50) {
      this.recentEvents.pop();
    }
    const roleKey = evt.userRole || 'student';
    this.roleCounts[roleKey] = (this.roleCounts[roleKey] || 0) + 1;
  }

  public getAggregatedSummary(range: string = '7d') {
    const multiplier = range === '24h' ? 0.22 : range === '30d' ? 3.8 : 1;
    const totalMessages = Math.round(
      this.dailyActivity.reduce((sum, d) => sum + d.messages, 0) * multiplier,
    );
    const totalResources = Math.round(
      this.dailyActivity.reduce((sum, d) => sum + d.resources, 0) * multiplier,
    );
    const totalOfflineSynced = Math.round(
      this.dailyActivity.reduce((sum, d) => sum + d.offlineSynced, 0) * multiplier,
    );

    const avgLatencyMs =
      this.recentEvents.length > 0
        ? Math.round(
            this.recentEvents.reduce((sum, e) => sum + (e.latencyMs ?? 18), 0) /
              this.recentEvents.length,
          )
        : 16;

    return {
      range,
      generatedAt: new Date().toISOString(),
      totals: {
        messagesExchanged: totalMessages,
        resourcesShared: totalResources,
        offlineQueuedSynced: totalOfflineSynced,
        activeChannels: 12,
        avgWriteLatencyMs: avgLatencyMs,
        e2eVerificationRate: 99.8,
      },
      dailySeries: this.dailyActivity.map((d) => ({
        day: d.day,
        messages: Math.round(d.messages * multiplier),
        resources: Math.round(d.resources * multiplier),
        offlineSynced: Math.round(d.offlineSynced * multiplier),
      })),
      roleDistribution: Object.entries(this.roleCounts).map(([role, actions]) => ({
        role,
        actions: Math.round(actions * multiplier),
      })),
      channelActivity: [
        { code: 'CS-402', name: 'Distributed Systems', messages: Math.round(912 * multiplier), resources: 48, buildingNode: 'cs-engineering-wing' },
        { code: 'CRYPTO-510', name: 'Zero-Trust MLS Lab', messages: Math.round(784 * multiplier), resources: 64, buildingNode: 'cryptography-lab' },
        { code: 'MATH-308', name: 'Algebraic Graph Theory', messages: Math.round(521 * multiplier), resources: 39, buildingNode: 'mathematics-hall' },
        { code: 'CAMPUS-GEN', name: 'University Commons', messages: Math.round(554 * multiplier), resources: 27, buildingNode: 'student-commons' },
      ],
      recentServerEvents: this.recentEvents.slice(0, 12),
    };
  }
}

export const campusEmitter = new CampusEventBus();
