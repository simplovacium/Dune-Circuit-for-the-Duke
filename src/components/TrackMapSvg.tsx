import React, { useMemo } from 'react';
import type { TrackMeta } from '../shared/types.ts';
import { buildTrackSamples } from '../game/trackBuilder.ts';

interface MinimapDot {
  id: string;
  x: number;
  z: number;
  color: string;
  isPlayer?: boolean;
}

interface TrackMapSvgProps {
  track: TrackMeta;
  dots?: MinimapDot[];
  className?: string;
}

export const TrackMapSvg: React.FC<TrackMapSvgProps> = ({ track, dots, className = 'w-28 h-28' }) => {
  const { pathD, bounds } = useMemo(() => {
    const samples = buildTrackSamples(track);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < samples.length; i += 3) {
      const p = samples[i].pos;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const pad = 35;
    minX -= pad;
    maxX += pad;
    minZ -= pad;
    maxZ += pad;
    const width = maxX - minX;
    const height = maxZ - minZ;

    const pts: string[] = [];
    for (let i = 0; i < samples.length; i += 4) {
      const p = samples[i].pos;
      const sx = ((p.x - minX) / width) * 100;
      const sy = ((p.z - minZ) / height) * 100;
      pts.push(`${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`);
    }
    pts.push('Z');

    return {
      pathD: pts.join(' '),
      bounds: { minX, minZ, width, height },
    };
  }, [track]);

  return (
    <svg viewBox="0 0 100 100" className={className} aria-label={`${track.name} circuit layout`}>
      <path
        d={pathD}
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="5.5"
        strokeLinejoin="round"
      />
      <path
        d={pathD}
        fill="none"
        stroke="rgba(255,255,255,0.75)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {dots?.map((dot) => {
        const cx = ((dot.x - bounds.minX) / bounds.width) * 100;
        const cy = ((dot.z - bounds.minZ) / bounds.height) * 100;
        return (
          <circle
            key={dot.id}
            cx={cx}
            cy={cy}
            r={dot.isPlayer ? 4.2 : 3}
            fill={dot.isPlayer ? '#f59e0b' : dot.color}
            stroke="#09090b"
            strokeWidth="1.2"
          />
        );
      })}
    </svg>
  );
};
