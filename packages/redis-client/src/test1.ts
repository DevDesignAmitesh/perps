import { HTTP_BACKEND_STREAM_CONFIGS, ORDER_ENGINE_STREAM_CONFIGS } from "@repo/common/common";
import { redisManager } from "."

try {
  const res = await redisManager.waitForData(
    // putting data in this thing
    HTTP_BACKEND_STREAM_CONFIGS.group_name,
    HTTP_BACKEND_STREAM_CONFIGS.consumer_grp,
    HTTP_BACKEND_STREAM_CONFIGS.stream,

    // waiting for the response from this thing
    ORDER_ENGINE_STREAM_CONFIGS.stream,
    { testing_data: [ { userId: "1202001001" } ] },
  );
  
  
  // TODO: check if we need to add loop in this (maybe not)
  for (const message of res.messages) {
    console.log("message ", message);
    const parsedResponse = JSON.parse(message.message.data ?? "{}")

    console.log("parsedResponse", parsedResponse);

    await redisManager.acknowledgeMent(
      HTTP_BACKEND_STREAM_CONFIGS.stream, 
      HTTP_BACKEND_STREAM_CONFIGS.group_name, 
      message.id
    )
  }
  
  
  
} catch {

}

  
