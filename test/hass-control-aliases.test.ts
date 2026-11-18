import { describe, expect, test } from "bun:test";
import { planControl } from "../src/hass/control";

// Regression 2026-11-17: the deck sent "temperature"/"hvac_mode"/… while the agent only knew "set_*", so every control was refused.
const climate = { state: "cool", attributes: { min_temp: 16, max_temp: 30, target_temp_step: 1, temperature: 26, hvac_modes: ["off", "auto", "cool", "fan_only"], fan_modes: ["auto", "low", "high"], swing_modes: ["highest", "auto"] } } as any;
describe("deck op names are accepted", () => {
  test("climate short names", () => {
    expect(planControl("climate.working_ac", climate, "temperature", 27)).toMatchObject({ service: "climate.set_temperature" });
    expect(planControl("climate.working_ac", climate, "hvac_mode", "auto")).toMatchObject({ service: "climate.set_hvac_mode", data: { hvac_mode: "auto" } });
    expect(planControl("climate.working_ac", climate, "fan_mode", "high")).toMatchObject({ service: "climate.set_fan_mode" });
    expect(planControl("climate.working_ac", climate, "swing_mode", "auto")).toMatchObject({ service: "climate.set_swing_mode" });
    expect(planControl("climate.working_ac", climate, "power", false)).toMatchObject({ service: "climate.turn_off" });
  });
  test("canonical names still work and limits still apply", () => {
    expect(planControl("climate.working_ac", climate, "set_temperature", 27)).toMatchObject({ service: "climate.set_temperature" });
    expect(planControl("climate.working_ac", climate, "temperature", 40)).toHaveProperty("error");
  });
  test("cover and vacuum short names", () => {
    const cover = { state: "open", attributes: { supported_features: 15, current_position: 50 } } as any;
    expect(planControl("cover.rem", cover, "close", undefined)).toMatchObject({ service: "cover.close_cover" });
    expect(planControl("vacuum.robot", { state: "docked", attributes: {} } as any, "dock", undefined)).toMatchObject({ service: "vacuum.return_to_base" });
  });
});
