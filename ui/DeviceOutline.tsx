import type { SystemLayout } from "../src/types";

type Point = readonly [number, number];

function Rotor({
  center: [x, y],
  radius,
  angle,
}: {
  center: Point;
  radius: number;
  angle: number;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={radius} className="device-guide" />
      <g transform={`rotate(${angle}) scale(${radius / 82})`}>
        <path
          className="device-solid"
          d="M-8-4C-32-20-65-22-76-11C-69-2-36 5-8 5C18 19 60 24 76 12C68 1 34-6 8-5Z"
        />
      </g>
      <circle r={radius > 70 ? 19 : 15} className="device-solid" />
      <circle r="8" />
      <circle r="2.5" />
    </g>
  );
}

function DroneBody() {
  return (
    <>
      <path
        className="device-solid"
        d="M379 139H441L468 173V277L443 311H377L352 277V173Z"
      />
      <path d="M383 149H437L458 178V273L438 301H382L362 273V178ZM388 139V129H432V139M388 311V321H432V311M373 180H447M373 270H447M380 188V262M440 188V262" />
      {[
        [365, 174],
        [455, 174],
        [365, 276],
        [455, 276],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="3" />
          <circle cx={x} cy={y} r="7" />
        </g>
      ))}
      <path
        className="device-detail"
        d="M389 153V169M399 153V169M409 153V169M419 153V169M429 153V169M389 282V297M399 282V297M409 282V297M419 282V297M429 282V297M395 323V337H425V323"
      />
    </>
  );
}

const rotorCenters: Record<
  "quadrotor" | "hexarotor" | "octorotor",
  readonly Point[]
> = {
  quadrotor: [
    [170, 105],
    [650, 105],
    [170, 345],
    [650, 345],
  ],
  hexarotor: [
    [410, 70],
    [625, 147],
    [625, 303],
    [410, 380],
    [195, 303],
    [195, 147],
  ],
  octorotor: [
    [285, 72],
    [535, 72],
    [694, 160],
    [694, 290],
    [535, 378],
    [285, 378],
    [126, 290],
    [126, 160],
  ],
};

function Multirotor({ layout }: { layout: keyof typeof rotorCenters }) {
  const centers = rotorCenters[layout];
  const radius = layout === "quadrotor" ? 82 : layout === "hexarotor" ? 58 : 54;
  return (
    <>
      {layout === "quadrotor" ? (
        <>
          <path
            className="device-solid"
            d="M375 169L180 89L157 103L364 192ZM445 169L640 89L663 103L456 192ZM364 258L157 347L180 361L375 281ZM456 258L663 347L640 361L445 281Z"
          />
          <path
            className="device-detail"
            d="M365 179L173 102M455 179L647 102M365 270L173 348M455 270L647 348"
          />
        </>
      ) : (
        centers.map(([x, y]) => {
          const length = Math.hypot(x - 410, y - 225);
          const dx = (-(y - 225) / length) * 9,
            dy = ((x - 410) / length) * 9;
          return (
            <g key={`${x}-${y}`}>
              <path
                className="device-solid"
                d={`M${410 + dx} ${225 + dy}L${x + dx} ${y + dy}L${x - dx} ${y - dy}L${410 - dx} ${225 - dy}Z`}
              />
              <path className="device-detail" d={`M410 225L${x} ${y}`} />
            </g>
          );
        })
      )}
      {centers.map((center, index) => (
        <Rotor
          key={index}
          center={center}
          radius={radius}
          angle={index % 2 ? -24 : 24}
        />
      ))}
      <DroneBody />
    </>
  );
}

function FixedWing() {
  return (
    <>
      <path
        className="device-solid"
        d="M385 163L72 232V256L391 219H429L748 256V232L435 163Z"
      />
      <path
        className="device-detail"
        d="M97 244L386 193M723 244L434 193M166 236L168 251M272 214L275 235M654 236L652 251M548 214L545 235"
      />
      <path
        className="device-solid"
        d="M399 342L287 388V402L404 378H416L533 402V388L421 342Z"
      />
      <path className="device-detail" d="M303 391L399 364M517 391L421 364" />
      <path
        className="device-solid"
        d="M410 28C390 58 383 97 382 143L389 327L396 384H424L431 327L438 143C437 97 430 58 410 28Z"
      />
      <path
        className="device-window"
        d="M400 75Q410 58 420 75L425 123Q410 135 395 123Z"
      />
      <path
        className="device-detail"
        d="M390 160H430M391 246H429M393 301H427M401 146V283M419 146V283"
      />
      <path
        className="device-solid"
        d="M405 357L410 321L415 357V411L410 423L405 411Z"
      />
      <path d="M368 336L400 331M420 341L452 336" />
      <circle cx="410" cy="336" r="10" className="device-solid" />
      <circle cx="410" cy="336" r="3" />
    </>
  );
}

function RobotArm() {
  return (
    <>
      <path className="device-detail" d="M126 386H724" />
      <rect
        className="device-solid"
        x="180"
        y="351"
        width="110"
        height="35"
        rx="3"
      />
      <path
        className="device-solid"
        d="M205 351V301H265V351ZM217 279L328 133L362 159L252 305ZM340 130L540 195L530 227L350 162ZM528 198L596 162L610 186L542 223Z"
      />
      <path
        className="device-detail"
        d="M235 292L345 146L535 211L603 174M215 362H255M215 374H255"
      />
      {(
        [
          [235, 292, 31],
          [345, 146, 27],
          [535, 211, 22],
          [603, 174, 17],
        ] as const
      ).map(([x, y, radius]) => (
        <g key={x}>
          <circle className="device-solid" cx={x} cy={y} r={radius} />
          <circle cx={x} cy={y} r={radius - 8} />
          <circle cx={x} cy={y} r="3" />
        </g>
      ))}
      <g transform="translate(613 169) rotate(-28)">
        <path
          className="device-solid"
          d="M0-16H22L39-8V-2H32L18-8H8V8H18L32 2H39V8L22 16H0Z"
        />
        <path className="device-detail" d="M9-16V16" />
      </g>
      <rect
        className="device-solid"
        x="616"
        y="270"
        width="96"
        height="116"
        rx="4"
      />
      <rect x="628" y="282" width="43" height="25" rx="2" />
      <circle cx="690" cy="293" r="5" />
      <path
        className="device-detail"
        d="M630 366H698M630 359H698M630 352H698M692 319V337"
      />
    </>
  );
}

function AutonomousTruck() {
  return (
    <>
      <path className="device-detail" d="M102 379H748" />
      <rect
        className="device-solid"
        x="144"
        y="170"
        width="366"
        height="132"
        rx="4"
      />
      <path
        className="device-detail"
        d="M157 183H497V290H157ZM181 183V290M474 183V290M319 183V290"
      />
      <path
        className="device-solid"
        d="M516 304V177H623L679 229H709V309H660L652 290H568L560 309H516Z"
      />
      <path
        className="device-window"
        d="M533 189H578V226H533ZM589 189H617L658 226H589Z"
      />
      <path d="M533 238H597V292M581 244H589M686 245H709M691 265H709M669 238V272" />
      <path
        className="device-solid"
        d="M136 302H526V316H136ZM708 291H726V316H708Z"
      />
      <path d="M145 322H214M286 322H574M646 322H696M213 335H163V311M286 341H574" />
      {([250, 610] as const).map((x) => (
        <g key={x}>
          <circle className="device-solid device-tire" cx={x} cy="333" r="35" />
          <circle cx={x} cy="333" r="22" />
          <circle cx={x} cy="333" r="9" />
          <path
            className="device-detail"
            d={`M${x - 14} 333H${x + 14}M${x} 319V347`}
          />
        </g>
      ))}
      <path d="M576 177V158H604V177" />
      <rect
        className="device-solid"
        x="575"
        y="144"
        width="30"
        height="14"
        rx="4"
      />
      <path
        className="device-detail"
        d="M581 149H599M118 222H131V265H118M143 246H131"
      />
      <path
        className="device-guide"
        d="M562 139Q590 120 618 139M552 127Q590 101 628 127"
      />
    </>
  );
}

export const OUTLINE_BOUNDS = { x: 0, y: 0, width: 820, height: 450 } as const;
export function DeviceOutline({ layout }: { layout: SystemLayout }) {
  if (layout === "blank") return null;
  return (
    <svg
      className="device-outline"
      width={820}
      height={450}
      viewBox="0 0 820 450"
      aria-hidden="true"
      data-layout={layout}
    >
      {(layout === "quadrotor" ||
        layout === "hexarotor" ||
        layout === "octorotor") && <Multirotor layout={layout} />}
      {layout === "fixed-wing" && <FixedWing />}
      {layout === "robot-arm" && <RobotArm />}
      {layout === "truck" && <AutonomousTruck />}
    </svg>
  );
}
