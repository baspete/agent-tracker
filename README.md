# Build Agent Tracker

This project uses a raspberry pi and an SSD1306-based OLED display to show a value over time. The config contains examples for an Azure DevOps agent pool, a piaware host, and a tempest weather station.

## Ingredients

1. **A Raspberry Pi** - I used a 3B+ but pretty much anything will work.
1. **A Display** - I wired up a small I2C driven OLED display that uses the SSD1306 chipset. If you provide the I2C address in `config.js` it will render current values.

## Assembly

| Physical Pin | Logical Pin | Connect To     |
| ------------ | ----------- | -------------- |
| 3            | SDA         | Display SDA    |
| 4            | 5V          | Display Vcc    |
| 5            | SCL         | Display SCL    |
| 6            | Ground      | Display Ground |

## Setup

### Install an operating system

There are a ton of tutorials out there for getting a Raspberry Pi up and running so we won't go over that here. I used [Raspberry Pi OS Lite](https://www.raspberrypi.org/software/operating-systems/#raspberry-pi-os-32-bit) for this project but any distro capable of running nodejs applications will work.

Make sure you [set up WiFi and enable SSH](https://www.raspberrypi.org/documentation/remote-access/ssh/README.md) and can SSH into your Raspberry Pi.

### Install tooling

Once you've got your OS set up you'll need to install a few tools. SSH into your Raspberry Pi and install the following:

1. **NodeJS and NPM** - Tutorial [here](https://medium.com/@thedyslexiccoder/how-to-update-nodejs-npm-on-a-raspberry-pi-4-da75cad4148c).
1. **Git** - Tutorial [here](https://linuxize.com/post/how-to-install-git-on-raspberry-pi/)
1. **Yarn** - Not strictly needed, but faster than NPM. Instructions [here](https://classic.yarnpkg.com/en/docs/install).

### Configure I2C

This application depends on the [i2c-bus](https://github.com/fivdi/i2c-bus) package. You need to configure I2C on your Raspberry PI to use it. Follow the instructions here: 

https://github.com/fivdi/i2c-bus/blob/master/doc/raspberry-pi-i2c.md#configuring-i2c-with-raspi-config

(basically, go into raspi-config and enable I2C)

### Edit app.js and update the data source(s)

(There's a super-handy VS Code plugin called [Remote - SSH](https://github.com/Microsoft/vscode-remote-release) that you can use to edit code on your Raspberry Pi from VS Code.)

Open the `config.js` file in your editor. Edit the values as needed, keeping the following in mind:

- **displayAddress** (optional) - If you have a I2C OLED display with the SSD1306 chipset, set the I2C address here.

For `sources` I'm showing a few different examples Here's what those parameters mean:

- **url** - (required) where to get the data. If `filter` is not defined, this must return a number.
- **dataInterval** - (optonal) How often (in seconds) to retrieve new data.
- **filter** - (optional) A synchronous function to apply to the response from `url`. This must return a number.
- **callback** - (optional) An asynchronous function to run after each sample. This most recent sample value is passed to this function. Use this if for example you wanted to log each sample to the filesystem or a remote store.

#### Environment Variables

If you put a file called `.env` in the root of your application, the `dotenv` library will grab any values out of it and put them into the Nodejs environment at runtime. This allows you to keep sensitive information out of your source code (this file is ignored by git). Here's what I put in my `config.js`:

```
# Weatherflow Stuff
WEATHERFLOW_TOKEN='blah blah blah'
WEATHERFLOW_STATION_ID=40983

# Azure DevOps Stuff
DEVOPS_ORG='geaviationdigital-dss'
DEVOPS_PAT='blah blah blah'
AGENT_POOL_ID=27

# PiAware Stuff
PIAWARE_HOST='192.168.1.5'
```

These envionment variables can then be read in your code as `process.env.WEATHERFLOW_TOKEN`, `process.env.WEATHERFLOW_STATION_ID` etc.

## Usage

You can test your application by typing

```
node app.js
```

If everything is working you'll see some logging info in the console. If you've properly set the values in the `duty` array, in a minute or two the heater should be warm enough to keep the Stirling engine spinning. Give the flywheel a push and it should keep going.

As your Raspberry Pi updates data based on what you've put in `sources` the PWM duty cycle will change accordingly, changing the amount of heat going into your Stirling engine and therefore changing its rotation speed.

### Starting automatically

You can use the fantastic [PM2](https://pm2.keymetrics.io/docs/usage/quick-start/) to automatically start your app when you power up the Raspberry Pi.

1. Install pm2 globally with `sudo npm install -g pm2`
2. With your app stopped, go to your app directory and type `pm2 start app.js`. Verify that your app is running with `pm2 ls`.
3. Set up the boot strategy by typing `pm2 startup`. This will configure your Operating System's boot service as needed to start your app when it boots up.
4. Type `pm2 save` to save the process list for automatic respawn.

That's it. Now your app will start up automatically anytime you power up your RPi. You can monitor your app and see log output with `pm2 monit`.
2
