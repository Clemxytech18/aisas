import React from "react";
import { Image } from "react-native";

const lightLogo = require("../../assets/branding/aisas-logo-light.png");
const darkLogo = require("../../assets/branding/aisas-logo-dark.png");
const appIcon = require("../../assets/branding/aisas-app-icon.png");

/** The original 3:1 logo artwork is preserved in both themes. */
export function BrandLogo({
  night,
  width = 180,
  accessible = true,
}: {
  night: boolean;
  width?: number;
  accessible?: boolean;
}) {
  return (
    <Image
      source={night ? darkLogo : lightLogo}
      resizeMode="contain"
      accessible={accessible}
      accessibilityLabel="AISAS by ClemxyTech"
      style={{ width, height: width / 3 }}
    />
  );
}

export function BrandIcon({
  size = 28,
  accessible = true,
}: {
  size?: number;
  accessible?: boolean;
}) {
  return (
    <Image
      source={appIcon}
      resizeMode="contain"
      accessible={accessible}
      accessibilityLabel="AISAS"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
      }}
    />
  );
}
