import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

// Registered once for the whole motion layer, so effects import from here instead of "gsap".
gsap.registerPlugin(CustomEase, ScrollTrigger, SplitText);

export { CustomEase, gsap, ScrollTrigger, SplitText };
