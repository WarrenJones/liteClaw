import { z } from "zod";

import { config } from "../../config.js";
import { LiteClawError } from "../errors.js";
import { logDebug } from "../logger.js";
import type { LiteClawTool } from "../tools.js";

const GEOAPI_BASE = "https://geoapi.qweather.com/v2/city/lookup";

type GeoLocation = {
  id: string;
  name: string;
  adm1: string;
  country: string;
};

type WeatherNow = {
  temp: string;
  feelsLike: string;
  text: string;
  humidity: string;
  windDir: string;
  windScale: string;
  windSpeed: string;
  vis: string;
};

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "LiteClaw/0.1.0" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupCity(
  city: string,
  apiKey: string,
  timeoutMs: number
): Promise<GeoLocation | null> {
  const url = `${GEOAPI_BASE}?location=${encodeURIComponent(city)}&key=${apiKey}`;
  const response = await fetchWithTimeout(url, timeoutMs);

  if (!response.ok) {
    throw new LiteClawError("GeoAPI request failed", {
      code: "tool_execution_failed",
      category: "external",
      retryable: true,
      details: { status: response.status }
    });
  }

  const data = (await response.json()) as {
    code: string;
    location?: GeoLocation[];
  };

  if (data.code !== "200" || !data.location?.length) {
    return null;
  }

  return data.location[0];
}

async function fetchWeather(
  locationId: string,
  apiKey: string,
  baseUrl: string,
  timeoutMs: number
): Promise<WeatherNow> {
  const url = `${baseUrl}/v7/weather/now?location=${locationId}&key=${apiKey}`;
  const response = await fetchWithTimeout(url, timeoutMs);

  if (!response.ok) {
    throw new LiteClawError("Weather API request failed", {
      code: "tool_execution_failed",
      category: "external",
      retryable: true,
      details: { status: response.status }
    });
  }

  const data = (await response.json()) as {
    code: string;
    now?: WeatherNow;
  };

  if (data.code !== "200" || !data.now) {
    throw new LiteClawError("Weather API returned unexpected data", {
      code: "tool_execution_failed",
      category: "external",
      retryable: false,
      details: { code: data.code }
    });
  }

  return data.now;
}

function formatWeather(
  location: GeoLocation,
  weather: WeatherNow
): string {
  return [
    `📍 ${location.name}（${location.adm1}，${location.country}）`,
    `🌡️ 温度：${weather.temp}°C（体感 ${weather.feelsLike}°C）`,
    `🌤️ 天气：${weather.text}`,
    `💧 湿度：${weather.humidity}%`,
    `🌬️ 风向：${weather.windDir} ${weather.windScale}级（${weather.windSpeed}km/h）`,
    `👁️ 能见度：${weather.vis}km`
  ].join("\n");
}

export const weatherTool: LiteClawTool = {
  name: "weather",
  description:
    "查询指定城市的当前天气信息，包括温度、天气状况、湿度、风力等。",
  parameters: z.object({
    city: z.string().describe("城市名称，如「北京」「上海」「Tokyo」")
  }),
  async run(context) {
    const city = context.arguments?.city as string;

    if (!city) {
      return { text: "缺少 city 参数。" };
    }

    const apiKey = config.weather.apiKey;
    if (!apiKey) {
      return { text: "天气服务未配置（缺少 QWEATHER_API_KEY）。" };
    }

    const timeoutMs = config.agent.toolExecutionTimeoutMs;

    logDebug("tool.weather.requesting", {
      city,
      chatId: context.chatId
    });

    try {
      const location = await lookupCity(city, apiKey, timeoutMs);
      if (!location) {
        return {
          text: `未找到城市「${city}」，请检查城市名称是否正确。`,
          metadata: { city }
        };
      }

      const weather = await fetchWeather(
        location.id,
        apiKey,
        config.weather.baseUrl,
        timeoutMs
      );

      return {
        text: formatWeather(location, weather),
        metadata: {
          city,
          locationId: location.id,
          temp: weather.temp,
          text: weather.text
        }
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          text: `天气查询超时（${timeoutMs}ms）`,
          metadata: { city }
        };
      }

      throw error;
    }
  }
};
