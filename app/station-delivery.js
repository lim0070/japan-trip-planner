// Station-level references checked against operator sources. No OSM geometry is included.
export default {
  "schemaVersion": 1,
  "checkedOn": "2026-11-21",
  "scope": "Station-level operator references. Check the operator for current destinations, acceptance times and charges.",
  "stations": [
    {
      "stationId": "tokyo",
      "name": "Sagawa Tokyo Service Center",
      "type": "staffed counter",
      "where": "First Avenue Tokyo Station, 1F, by the Shinkansen Nihombashi gate.",
      "service": "Drop off luggage for Sagawa hotel or airport delivery. The operator lists the routes and acceptance conditions.",
      "sourceUrl": "https://www.sagawa-exp.co.jp/hands-freetravel/english/service-centers/tokyo-station.html",
      "locationSourceUrl": "https://www.jalabc.com/en/hands-freetravel/hotel-baggage-delivery/tokyo-station.html"
    },
    {
      "stationId": "shinjuku",
      "name": "Sagawa Shinjuku Service Center",
      "type": "staffed counter",
      "where": "Tourist Information Center Tokyo, 3F of Busta Shinjuku expressway bus terminal.",
      "service": "The Sagawa desk accepts passenger baggage for hotel or airport delivery. Check the destination and drop-off deadline with the operator.",
      "sourceUrl": "https://www.sagawa-exp.co.jp/hands-freetravel/english/service-centers/shinjuku-bus-terminal.html"
    },
    {
      "stationId": "shibuya",
      "name": "Multi-Ecube hotel delivery",
      "type": "self-service locker",
      "where": "Eligible Multi-Ecube lockers at Shibuya Station. Select a shipping-enabled locker in the operator’s booking system.",
      "service": "Reserve online to send a bag to a participating hotel in Tokyo’s 23 wards or Urayasu the same day. Check the hotel and drop-off deadline when booking.",
      "sourceUrl": "https://www.jre-sl.co.jp/news/20250602_ho01/",
      "bookingUrl": "https://multiecube.com/",
      "serviceNoticeUrl": "https://multiecube.com/notice/8_x55ttbn"
    },
    {
      "stationId": "kyoto",
      "name": "Crosta Kyoto",
      "type": "staffed counter",
      "where": "JR Kyoto Station, B1, beneath the central gate for conventional trains.",
      "service": "Send bags to participating Kyoto or Osaka hotels, or arrange collection at Osaka or Shin-Osaka station. The deadline depends on the route.",
      "sourceUrl": "https://handsfree-japan.com/en/kyoto/"
    },
    {
      "stationId": "osaka",
      "name": "Crosta Osaka",
      "type": "staffed counter",
      "where": "JR Osaka Station, 1F on the north side, outside the gates beside Nippon Travel Agency near the Central Gate.",
      "service": "Drop off luggage for delivery to a participating Osaka city hotel. Guests of participating hotels can also arrange collection at this station.",
      "sourceUrl": "https://handsfree-japan.com/en/osaka/"
    }
  ]
};
