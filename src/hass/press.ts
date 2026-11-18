import { t } from "../i18n";
/** What pressing an `entity` tile does, per domain. Returns null when nothing should happen (state only). */
export function entityPress(entityId: string): { service: string; entityId: string } | { error: string } {
  const domain = entityId.split(".")[0]!;
  switch (domain) {
    case "light": case "switch": case "fan": case "input_boolean": case "automation": case "cover": case "humidifier": case "siren":
      return { service: `${domain}.toggle`, entityId };
    case "scene": case "script": return { service: `${domain}.turn_on`, entityId };
    case "button": case "input_button": return { service: `${domain}.press`, entityId };
    case "media_player": return { service: "media_player.media_play_pause", entityId };
    case "lock": return { error: t("this lock only shows status, it cannot be controlled from here") };
    default: return { error: t("pressing {domain} is not supported", { domain }) };
  }
}
