import { Router } from "express";
import { getAnalytics } from "../controllers/analyticsController";

const router = Router();

router.get("/analytics", getAnalytics);

export { router as analyticsRoutes };
