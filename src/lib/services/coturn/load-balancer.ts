import { CoturnServersService, TurnServer } from './servers';
import { CoturnCredentialsService, TurnServerConfig } from './credentials';
import { connectDB } from '@/lib/db/connection';
import Call from '@/lib/db/models/Call';
import { analyticsTracker } from '../analytics/tracker';

export interface LoadBalancingStrategy {
  name: 'round_robin' | 'least_connections' | 'geographic' | 'weighted' | 'random';
  options?: Record<string, any>;
}

export interface ServerSelection {
  server: TurnServer;
  credentials: TurnServerConfig;
  reason: string;
  fallbackServers: TurnServer[];
}

export interface LoadBalancerMetrics {
  totalRequests: number;
  successfulAllocations: number;
  failedAllocations: number;
  serverUtilization: Record<string, number>;
  averageResponseTime: number;
  regionDistribution: Record<string, number>;
}

export class CoturnLoadBalancer {
  private static currentStrategy: LoadBalancingStrategy = { name: 'geographic' };
  private static roundRobinIndex = 0;
  private static serverWeights = new Map<string, number>();
  private static requestCounts = new Map<string, number>();
  private static metrics: LoadBalancerMetrics = {
    totalRequests: 0,
    successfulAllocations: 0,
    failedAllocations: 0,
    serverUtilization: {},
    averageResponseTime: 0,
    regionDistribution: {}
  };

  // Get TURN server configuration for a call
  static async getServerForCall(
    callId: string,
    userId: string,
    userRegion?: string,
    strategy?: LoadBalancingStrategy
  ): Promise<ServerSelection | null> {
    try {
      const startTime = Date.now();
      this.metrics.totalRequests++;

      const loadStrategy = strategy || this.currentStrategy;
      const selectedServer = await this.selectServer(loadStrategy, userRegion, userId);

      if (!selectedServer) {
        this.metrics.failedAllocations++;
        await this.trackAllocationFailure(callId, userId, 'No available servers');
        return null;
      }

      // Generate credentials for the selected server
      const credentials = await this.generateServerCredentials(selectedServer, userId);

      // Get fallback servers
      const fallbackServers = await this.getFallbackServers(selectedServer, userRegion);

      // Update call record with server information
      await this.updateCallWithServer(callId, selectedServer, credentials);

      // Update metrics
      const responseTime = Date.now() - startTime;
      this.updateMetrics(selectedServer, responseTime, true);

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        userId,
        'coturn',
        'server_allocation',
        {
          success: true,
          serverId: selectedServer.id,
          region: selectedServer.region,
          strategy: loadStrategy.name,
          responseTime
        }
      );

      return {
        server: selectedServer,
        credentials,
        reason: this.getSelectionReason(loadStrategy, selectedServer),
        fallbackServers
      };

    } catch (error: any) {
      this.metrics.failedAllocations++;
      await this.trackAllocationFailure(callId, userId, error.message);
      console.error('Error getting server for call:', error);
      return null;
    }
  }

  // Set load balancing strategy
  static setStrategy(strategy: LoadBalancingStrategy): void {
    this.currentStrategy = strategy;
    console.log(`Load balancing strategy changed to: ${strategy.name}`);
  }

  // Get current strategy
  static getStrategy(): LoadBalancingStrategy {
    return this.currentStrategy;
  }

  // Get load balancer metrics
  static getMetrics(): LoadBalancerMetrics {
    return { ...this.metrics };
  }

  // Reset metrics
  static resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulAllocations: 0,
      failedAllocations: 0,
      serverUtilization: {},
      averageResponseTime: 0,
      regionDistribution: {}
    };
  }

  // Release server allocation (when call ends)
  static async releaseServerAllocation(callId: string): Promise<void> {
    try {
      await connectDB();

      const call = await Call.findById(callId);
      if (!call?.coturnServer?.server) {
        return;
      }

      const serverId = call.coturnServer.server;
      
      // Decrement server usage
      await CoturnServersService.updateServer(serverId, {
        currentUsers: Math.max(0, (await this.getServerCurrentUsers(serverId)) - 1)
      });

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        call.callerId.toString(),
        'coturn',
        'server_release',
        {
          serverId,
          callDuration: call.duration
        }
      );

    } catch (error) {
      console.error('Error releasing server allocation:', error);
    }
  }

  // Get server recommendations based on region and load
  static async getServerRecommendations(
    userRegion?: string,
    limit: number = 3
  ): Promise<Array<{ server: TurnServer; score: number; reason: string }>> {
    try {
      const allServers = await CoturnServersService.getAllServers();
      const activeServers = allServers.filter(server => server.isActive);

      if (activeServers.length === 0) {
        return [];
      }

      // Score servers based on multiple factors
      const scoredServers = activeServers.map(server => ({
        server,
        score: this.calculateServerScore(server, userRegion),
        reason: this.getScoreReason(server, userRegion)
      }));

      // Sort by score (highest first) and return top servers
      return scoredServers
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    } catch (error: any) {
      console.error('Error getting server recommendations:', error);
      return [];
    }
  }

  // Private helper methods
  private static async selectServer(
    strategy: LoadBalancingStrategy,
    userRegion?: string,
    userId?: string
  ): Promise<TurnServer | null> {
    const allServers = await CoturnServersService.getAllServers();
    const activeServers = allServers.filter(server => server.isActive);

    if (activeServers.length === 0) {
      return null;
    }

    switch (strategy.name) {
      case 'round_robin':
        return this.selectRoundRobin(activeServers);
      
      case 'least_connections':
        return this.selectLeastConnections(activeServers);
      
      case 'geographic':
        return this.selectGeographic(activeServers, userRegion);
      
      case 'weighted':
        return this.selectWeighted(activeServers);
      
      case 'random':
        return this.selectRandom(activeServers);
      
      default:
        return this.selectGeographic(activeServers, userRegion);
    }
  }

  private static selectRoundRobin(servers: TurnServer[]): TurnServer {
    const server = servers[this.roundRobinIndex % servers.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % servers.length;
    return server;
  }

  private static selectLeastConnections(servers: TurnServer[]): TurnServer {
    return servers.reduce((best, current) => 
      current.currentUsers < best.currentUsers ? current : best
    );
  }

  private static selectGeographic(servers: TurnServer[], userRegion?: string): TurnServer {
    if (!userRegion) {
      return this.selectLeastConnections(servers);
    }

    // First try to find servers in the same region
    const regionServers = servers.filter(server => server.region === userRegion);
    if (regionServers.length > 0) {
      return this.selectLeastConnections(regionServers);
    }

    // Fallback to closest region or least connections
    return this.selectLeastConnections(servers);
  }

  private static selectWeighted(servers: TurnServer[]): TurnServer {
    const totalWeight = servers.reduce((sum, server) => {
      const weight = this.serverWeights.get(server.id) || server.maxUsers;
      return sum + weight;
    }, 0);

    let random = Math.random() * totalWeight;
    
    for (const server of servers) {
      const weight = this.serverWeights.get(server.id) || server.maxUsers;
      random -= weight;
      if (random <= 0) {
        return server;
      }
    }

    return servers[0]; // Fallback
  }

  private static selectRandom(servers: TurnServer[]): TurnServer {
    return servers[Math.floor(Math.random() * servers.length)];
  }

  private static calculateServerScore(server: TurnServer, userRegion?: string): number {
    let score = 100; // Base score

    // Load factor (higher load = lower score)
    const loadFactor = server.currentUsers / server.maxUsers;
    score -= loadFactor * 40;

    // Response time factor (higher response time = lower score)
    const responseTimeFactor = Math.min(server.responseTime / 1000, 1); // Cap at 1 second
    score -= responseTimeFactor * 30;

    // Regional preference (same region = higher score)
    if (userRegion && server.region === userRegion) {
      score += 20;
    }

    // Health factor
    if (!server.isActive) {
      score -= 50;
    }

    return Math.max(0, score);
  }

  private static getScoreReason(server: TurnServer, userRegion?: string): string {
    const reasons: string[] = [];

    if (userRegion && server.region === userRegion) {
      reasons.push('same region');
    }

    const loadPercent = (server.currentUsers / server.maxUsers) * 100;
    if (loadPercent < 30) {
      reasons.push('low load');
    } else if (loadPercent > 80) {
      reasons.push('high load');
    }

    if (server.responseTime < 100) {
      reasons.push('fast response');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'available';
  }

  private static getSelectionReason(strategy: LoadBalancingStrategy, server: TurnServer): string {
    switch (strategy.name) {
      case 'round_robin':
        return 'Round robin selection';
      case 'least_connections':
        return `Least connections (${server.currentUsers} users)`;
      case 'geographic':
        return `Geographic proximity (${server.region})`;
      case 'weighted':
        return 'Weighted selection based on capacity';
      case 'random':
        return 'Random selection';
      default:
        return 'Default selection';
    }
  }

  private static async generateServerCredentials(
    server: TurnServer,
    userId: string
  ): Promise<TurnServerConfig> {
    const credentials = await CoturnCredentialsService.generateCredentials({
      userId,
      region: server.region,
      ttl: 12 * 60 * 60 // 12 hours
    });

    return {
      urls: [
        `${server.protocol}:${server.url}:${server.port}`,
        `turn:${server.url}:${server.port}?transport=${server.protocol}`
      ],
      username: credentials.username,
      credential: credentials.credential,
      credentialType: 'password'
    };
  }

  private static async getFallbackServers(
    primaryServer: TurnServer,
    userRegion?: string
  ): Promise<TurnServer[]> {
    const allServers = await CoturnServersService.getAllServers();
    
    return allServers
      .filter(server => 
        server.id !== primaryServer.id && 
        server.isActive
      )
      .sort((a, b) => {
        // Prefer same region, then by load
        if (userRegion) {
          const aRegionMatch = a.region === userRegion ? 1 : 0;
          const bRegionMatch = b.region === userRegion ? 1 : 0;
          if (aRegionMatch !== bRegionMatch) {
            return bRegionMatch - aRegionMatch;
          }
        }
        return a.currentUsers - b.currentUsers;
      })
      .slice(0, 2); // Return top 2 fallback servers
  }

  private static async updateCallWithServer(
    callId: string,
    server: TurnServer,
    credentials: TurnServerConfig
  ): Promise<void> {
    try {
      await connectDB();

      await Call.findByIdAndUpdate(callId, {
        coturnServer: {
          region: server.region,
          server: server.id,
          username: credentials.username,
          credential: credentials.credential
        }
      });

      // Increment server usage
      await CoturnServersService.updateServer(server.id, {
        currentUsers: server.currentUsers + 1,
        load: Math.min(100, ((server.currentUsers + 1) / server.maxUsers) * 100)
      });

    } catch (error) {
      console.error('Error updating call with server:', error);
    }
  }

  private static updateMetrics(server: TurnServer, responseTime: number, success: boolean): void {
    this.metrics.successfulAllocations += success ? 1 : 0;
    
    // Update server utilization
    const utilizationKey = `${server.region}_${server.id}`;
    this.metrics.serverUtilization[utilizationKey] = 
      (this.metrics.serverUtilization[utilizationKey] || 0) + 1;

    // Update region distribution
    this.metrics.regionDistribution[server.region] = 
      (this.metrics.regionDistribution[server.region] || 0) + 1;

    // Update average response time
    const totalResponseTime = this.metrics.averageResponseTime * (this.metrics.totalRequests - 1);
    this.metrics.averageResponseTime = (totalResponseTime + responseTime) / this.metrics.totalRequests;
  }

  private static async trackAllocationFailure(callId: string, userId: string, reason: string): Promise<void> {
    await analyticsTracker.trackFeatureUsage(
      userId,
      'coturn',
      'server_allocation',
      {
        success: false,
        error: reason,
        callId
      }
    );
  }

  private static async getServerCurrentUsers(serverId: string): Promise<number> {
    const allServers = await CoturnServersService.getAllServers();
    const server = allServers.find(s => s.id === serverId);
    return server?.currentUsers || 0;
  }
}