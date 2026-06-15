import { cn } from "~/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("vh-skeleton rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
