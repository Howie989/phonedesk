/** What the automation modules need from the Home Assistant client (src/hass, built separately). All optional at runtime. */
export interface HassState { state: string; attributes?: Record<string, any> }

export interface HassWeather {
  state: string;
  attributes: Record<string, any>;
  hourly?: any[];
  daily?: any[];
}

export interface HassLike {
  connected(): boolean;
  getState(entityId: string): HassState | undefined;
  callService(service: string, entityId?: string, data?: Record<string, unknown>): Promise<void>;
  /** Weather entity with forecasts when HA can give them. */
  weather?(entityId: string): Promise<HassWeather | null>;
  /** A weather.* entity to use for tiles that picked none ("auto"), null when Home Assistant has none. */
  weatherEntity?(): Promise<string | null>;
  /** Home Assistant's configured temperature unit, when known. */
  systemTempUnit?(): "c" | "f" | undefined;
  /** Selects on the same HA device as a light (scene pickers). */
  related?(entityId: string): { id: string; name?: string; options: string[]; current?: string | null }[];
  /** Called on every state change of a subscribed entity; returns an unsubscribe. */
  onState?(cb: (entityId: string, state: HassState | undefined) => void): () => void;
}
