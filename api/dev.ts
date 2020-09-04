import express from "express";
import respond, { prepareTypingsFolder } from "./typings";

const app = express();
app.use(respond);

prepareTypingsFolder("/tmp/typings").then(() => {
  app.listen(8080, () => {
    console.log("Listening on 8080!");
  });
});
