// All UI strings live here. The copy guard (scripts/check_copy.py) scans this file.
export const copy = {
  appName: "Relay",
  syntheticBanner:
    "Synthetic patients and referrals. Specialist responses and delivery are simulated.",
  practiceSetting: "Practice setting",
  simulatedResponse: "Simulated response",
  telehealthNote: "Ask the office whether a telehealth visit is offered",
  distanceBasis: "Straight-line miles between town centers",
  medicare: {
    accepts: "Accepts Medicare assignment",
    mayAccept: "May accept Medicare assignment — confirm with the office",
    source: "CMS directory",
  },
  hospital: {
    label: "Nearest hospital",
    bedsLabel: "med/surg + ICU + pediatric beds",
    icuLabel: "ICU beds",
    ratingLabel: "CMS overall star rating",
  },
  nav: {
    dashboard: "Dashboard",
    newReferral: "New referral",
    specialist: "Specialist office (simulated)",
    inbox: "PCP inbox",
  },
  placeholder: "This screen is built in Block 4.",
} as const;
