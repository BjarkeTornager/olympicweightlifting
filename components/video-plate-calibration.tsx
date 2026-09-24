"use client";
import { Button } from "./ui/button";

export type PlateCalibration = {
  // Plate centre as a fraction of the frame width/height.
  x: number;
  y: number;
  // Plate diameter as a fraction of the frame width.
  diameter: number;
  // Actual plate diameter in centimetres, as typed.
  cm: string;
  side: boolean;
  realTime: boolean;
};
export const defaultPlateCalibration: PlateCalibration = {
  x: 0.5,
  y: 0.5,
  diameter: 0.15,
  cm: "",
  side: false,
  realTime: false,
};

export function PlateCalibrationFields({
  busy,
  duration,
  frame,
  dimensions,
  calibration,
  onCaptureFrame,
  onChange,
}: {
  busy: boolean;
  duration: number;
  // Captured start frame as a data URL, or "" before capture.
  frame: string;
  dimensions: { w: number; h: number };
  calibration: PlateCalibration;
  // Seek the preview to the selection start and capture that frame.
  onCaptureFrame: () => void;
  onChange: (patch: Partial<PlateCalibration>) => void;
}) {
  return (
    <fieldset disabled={busy} className="video-calibration">
      <p>
        At the start of your selection, mark the visible plate centre. Adjust
        the circle to its outside edge and enter its actual diameter.
      </p>
      <Button
        variant="secondary"
        disabled={busy || !duration}
        onClick={onCaptureFrame}
      >
        Mark plate on start frame
      </Button>
      {frame && (
        <button
          className="video-seed"
          type="button"
          aria-label="Set plate centre on preview"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onChange({
              x: Math.max(
                0.03,
                Math.min(0.97, (e.clientX - rect.left) / rect.width),
              ),
              y: Math.max(
                0.03,
                Math.min(0.97, (e.clientY - rect.top) / rect.height),
              ),
            });
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frame} alt="Start frame for marking the plate" />
          <svg
            viewBox={`0 0 ${dimensions.w} ${dimensions.h}`}
            aria-hidden="true"
          >
            <circle
              cx={calibration.x * dimensions.w}
              cy={calibration.y * dimensions.h}
              r={(calibration.diameter * dimensions.w) / 2}
              fill="none"
              stroke="#ffde59"
              strokeWidth="4"
            />
            <circle
              cx={calibration.x * dimensions.w}
              cy={calibration.y * dimensions.h}
              r="5"
              fill="#ffde59"
            />
          </svg>
        </button>
      )}
      <div className="lifting-video-fields">
        <label>
          Centre from left (%)
          <input
            type="number"
            min="3"
            max="97"
            value={Math.round(calibration.x * 100)}
            onChange={(e) => {
              onChange({ x: Number(e.target.value) / 100 });
            }}
          />
        </label>
        <label>
          Centre from top (%)
          <input
            type="number"
            min="3"
            max="97"
            value={Math.round(calibration.y * 100)}
            onChange={(e) => {
              onChange({ y: Number(e.target.value) / 100 });
            }}
          />
        </label>
        <label>
          Circle size
          <input
            type="range"
            min="0.02"
            max="0.6"
            step="0.005"
            value={calibration.diameter}
            onChange={(e) => {
              onChange({ diameter: Number(e.target.value) });
            }}
          />
        </label>
        <label>
          Actual plate diameter (cm)
          <input
            type="number"
            min="5"
            max="100"
            value={calibration.cm}
            placeholder="Measure or check the plate"
            onChange={(e) => {
              onChange({ cm: e.target.value });
            }}
          />
        </label>
      </div>
      <label className="video-check">
        <input
          type="checkbox"
          checked={calibration.side}
          onChange={(e) => {
            onChange({ side: e.target.checked });
          }}
        />
        The camera is fixed and side-on, with the plate face visible.
      </label>
      <label className="video-check">
        <input
          type="checkbox"
          checked={calibration.realTime}
          onChange={(e) => {
            onChange({ realTime: e.target.checked });
          }}
        />
        Playback is real-time, with no slow-motion or speed edits.
      </label>
      <p className="fine-print">
        Unconfirmed timing keeps velocity unavailable. Even a plausible track
        can be wrong; check the overlay before using the estimates.
      </p>
    </fieldset>
  );
}
