import type * as React from "react";
import { cn } from "~/lib/utils";

/**
 * Card — instrument-panel surface.
 *
 * The new depth model: 1px borders carry the structure, not shadows.
 * A card is a flat panel with sharp edges and a slight radius.
 *
 * Variants:
 *  - default: bordered panel, white/card surface
 *  - flat: no border, used inside other panels
 *  - elevated: 1px border + subtle inner highlight on hover (interactive)
 */
function Card({
	className,
	size = "default",
	variant = "default",
	...props
}: React.ComponentProps<"div"> & {
	size?: "default" | "sm";
	variant?: "default" | "flat" | "elevated";
}) {
	return (
		<div
			data-slot="card"
			data-size={size}
			data-variant={variant}
			className={cn(
				"flex flex-col gap-4 overflow-hidden rounded-lg text-sm text-card-foreground",
				variant === "default" && "border border-border bg-card",
				variant === "flat" && "bg-transparent",
				variant === "elevated" &&
					"border border-border bg-card transition-colors hover:border-foreground/20",
				size === "default" && "p-5 has-data-[slot=card-footer]:pb-0",
				size === "sm" && "p-4 has-data-[slot=card-footer]:pb-0",
				"[--card-spacing:--spacing(5)] data-[size=sm]:[--card-spacing:--spacing(4)]",
				className,
			)}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"grid auto-rows-min items-start gap-1.5",
				"has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
				"[.border-b]:pb-4",
				className,
			)}
			{...props}
		/>
	);
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-title"
			className={cn(
				"font-semibold leading-tight tracking-tight text-base",
				"group-data-[size=sm]/card:text-sm",
				className,
			)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("text-sm text-muted-foreground leading-relaxed", className)}
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="card-content" className={cn("text-sm leading-relaxed", className)} {...props} />
	);
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
