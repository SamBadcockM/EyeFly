import { Router, type IRouter } from "express";
import healthRouter from "./health";
import overpassRouter from "./overpass";
import wikidataRouter from "./wikidata";

const router: IRouter = Router();

router.use(healthRouter);
router.use(overpassRouter);
router.use(wikidataRouter);

export default router;
