// Icones do player em SVG (traco arredondado), no lugar de emojis/caracteres unicode,
// que mudam de aparencia entre TVs, celulares e navegadores.
type IconProps = { className?: string }

function Icon({ className = "h-6 w-6", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" />
  </Icon>
)

export const StarIcon = ({ filled = false, ...props }: IconProps & { filled?: boolean }) => (
  <Icon {...props}>
    <path
      d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9L12 3.5Z"
      fill={filled ? "currentColor" : "none"}
    />
  </Icon>
)

export const PauseIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
  </Icon>
)

export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

export const Replay10Icon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4.5h4.5" />
    <text x="12" y="15.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">10</text>
  </Icon>
)

export const Forward10Icon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v4.5h-4.5" />
    <text x="12" y="15.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">10</text>
  </Icon>
)

export const PreviousIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18 5.5v13L9 12l9-6.5Z" fill="currentColor" />
    <path d="M6 5.5v13" />
  </Icon>
)

export const NextIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 5.5v13L15 12 6 5.5Z" fill="currentColor" />
    <path d="M18 5.5v13" />
  </Icon>
)

export const VolumeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
)

export const MuteIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
)

export const FullscreenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </Icon>
)

export const ExitFullscreenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />
  </Icon>
)
