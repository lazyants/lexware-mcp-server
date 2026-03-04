export interface EventSubscription {
  subscriptionId: string;
  eventType: string;
  callbackUrl: string;
  [key: string]: unknown;
}
