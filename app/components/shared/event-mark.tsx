/**
 * VisionHack event mark.
 *
 * A geometric VH monogram — two letters built from a single shared line.
 * The V is brand-filled; the H is outlined chrome. They share the
 * horizontal mid-bar of the H as the V's apex, which makes the two
 * letters feel coupled rather than stacked.
 *
 * Read it as: VH (VisionHack). The H's right vertical is shorter than
 * the left to echo the chevron motion of the previous aperture mark,
 * while keeping the VH monogram readable.
 *
 * Use:
 *   <EventMark size="sm" />      // 24px tile, sidebar
 *   <EventMark size="md" />      // 40px tile, sidebar header / mobile bar
 *   <EventMark size="lg" />      // 72px tile with label, login hero
 *   <EventMark size="xl" />      // 120px tile with label
 */

import { cn } from "~/lib/utils";

export type EventMarkSize = "sm" | "md" | "lg" | "xl";
export type EventMarkTone = "default" | "display" | "muted";

interface EventMarkProps {
	size?: EventMarkSize;
	tone?: EventMarkTone;
	className?: string;
	/** Optional accessible label. Defaults to "VisionHack". */
	label?: string;
}

interface SizeConfig {
	tile: number;
	stroke: number;
	gap: number;
	showLabel: boolean;
	labelSize: string;
}

const SIZE_MAP: Record<EventMarkSize, SizeConfig> = {
	sm: { tile: 24, stroke: 2, gap: 4, showLabel: false, labelSize: "text-xs" },
	md: { tile: 40, stroke: 2.5, gap: 8, showLabel: false, labelSize: "text-sm" },
	lg: { tile: 72, stroke: 4, gap: 12, showLabel: true, labelSize: "text-2xl" },
	xl: { tile: 120, stroke: 6, gap: 16, showLabel: true, labelSize: "text-5xl" },
};

/**
 * Brand color for the V stroke/fill in the standard and display tones.
 * The muted tone uses the chrome (foreground) instead.
 */
function vClass(tone: EventMarkTone) {
	if (tone === "muted") return "stroke-[var(--muted-foreground)] fill-transparent";
	return "fill-[var(--primary)] stroke-[var(--primary)]";
}

function hClass(tone: EventMarkTone) {
	if (tone === "muted") return "stroke-[var(--muted-foreground)]";
	return "stroke-[var(--foreground)]";
}

export function EventMark({
	size = "md",
	tone = "default",
	className,
	label = "VisionHack",
}: EventMarkProps) {
	const cfg = SIZE_MAP[size];

	return (
		<span
			className={cn("inline-flex items-center shrink-0", className)}
			style={{ gap: cfg.gap }}
			aria-label={label}
			role="img"
		>
			<svg
				width={cfg.tile}
				height={cfg.tile}
				viewBox="0 0 40 40"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				aria-hidden="true"
			>
				{/* V — brand-filled triangular wedge */}
				<path
					d="M3 5 L14 28 L20 28 L20 33 L11 33 L3 10 Z"
					className={vClass(tone)}
					strokeWidth={cfg.stroke * 0.5}
					strokeLinejoin="miter"
				/>

				{/* H — outlined chrome with brand-tinted crossbar */}
				{/* Left vertical */}
				<line
					x1="22"
					y1="5"
					x2="22"
					y2="35"
					className={hClass(tone)}
					strokeWidth={cfg.stroke}
					strokeLinecap="square"
				/>
				{/* Right vertical (shorter, echoing chevron motion) */}
				<line
					x1="35"
					y1="11"
					x2="35"
					y2="35"
					className={hClass(tone)}
					strokeWidth={cfg.stroke}
					strokeLinecap="square"
					opacity={tone === "muted" ? 0.6 : 0.85}
				/>
				{/* Crossbar (brand-tinted in default/display, neutral in muted) */}
				<line
					x1="22"
					y1="20"
					x2="35"
					y2="20"
					className={vClass(tone)}
					strokeWidth={cfg.stroke}
					strokeLinecap="square"
				/>
			</svg>
			{cfg.showLabel && (
				<span
					className={cn(
						"font-semibold tracking-tight",
						cfg.labelSize,
						tone === "display" && "text-foreground",
						tone === "muted" && "text-muted-foreground",
					)}
					aria-hidden="true"
				>
					{label}
				</span>
			)}
		</span>
	);
}

/**
 * Full identity lockup for hero panels — logo mark + optional tagline.
 */
interface IdentityLockupProps {
	tagline?: string;
	className?: string;
}

export function IdentityLockup({ tagline, className }: IdentityLockupProps) {
	return (
		<div className={cn("flex flex-col items-start gap-1", className)}>
			<img src="/logo.svg" alt="μLearn SCET · VisionHack 2026" className="w-44 h-auto lg:w-52" />
			{tagline && <span className="text-xs text-sidebar-foreground/50 pl-0.5">{tagline}</span>}
		</div>
	);
}
