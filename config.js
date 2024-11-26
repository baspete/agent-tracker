import dotenv from 'dotenv';
dotenv.config();

// (optional) Min/Max duty cycle. duty[0] is the min required to keep
// the stirling engine idling. duty[1] is the max to keep
// it from spinning like a monkey on cocaine and throwing a rod.
// duty: [0.4, 1],

// (optional) Length (ms) of each PWM interval.
// pwmInterval: 100,

// (optional) Heater control pin.
// heaterPin: 18, // physical pin 12

// (optional) I2C Display address
export const displayAddress = 0x3c;
export const displayWidth = 128;
export const displayHeight = 64

// Data sources, number of samples to show, interval, initial min/max guesses etc
export const sources = {
  wind: {
    // this is required
    url: `https://swd.weatherflow.com/swd/rest/observations/station/${process.env.WEATHERFLOW_STATION_ID}?token=${process.env.WEATHERFLOW_TOKEN}`,
    // these are optional
    minMax: [0, 10],
    samplesToShow: 10,
    dataInterval: 10,
    filter: function (response) {
      let val = response.data.obs[0]['wind_gust'];
      return val;
    },
  },
  aircraft: {
    // this is required
    url: `http://${process.env.PIAWARE_HOST}/dump1090-fa/data/aircraft.json`,
    // these are optional
    minMax: [0, 100],
    samplesToShow: 10,
    dataInterval: 20,
    filter: function (response) {
      let aircraft = response.data.aircraft.filter((a) => {
        return a.flight ? true : false;
      });
      return aircraft.length;
    },
  },
  agents: {
    // this is required
    url: `https://dev.azure.com/${process.env.DEVOPS_ORG}/_apis/distributedtask/pools/${process.env.AGENT_POOL_ID}/agents`,
    // these are optional
    minMax: [0, 20],
    samplesToShow: 10,
    dataInterval: 15,
    auth: {
      username: '',
      password: process.env.DEVOPS_PAT,
    },
    filter: function (response) {
      let agents = response.data.value.filter((a) => {
        return (
          a.provisioningState === 'RunningRequest' ||
          a.provisioningState === 'Provisioning'
        );
      });
      return agents.length;
    },
  },
};

