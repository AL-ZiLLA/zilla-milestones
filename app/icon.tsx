import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "32px",
          height: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#d6f26a",
          color: "#07110e",
          fontSize: 22,
          fontWeight: 700,
          borderRadius: 8,
        }}
      >
        Z
      </div>
    ),
    { ...size },
  );
}
