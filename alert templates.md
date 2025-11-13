/* Aster */
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "aster",
  "action": "buy",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 1.0,
  "take_profit_percent": 3.0
}

{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "aster",
  "action": "sell",
  "symbol": "{{ticker}}",
  "orderType": "market",
  "stop_loss_percent": 1.0,
  "take_profit_percent": 3.0
}


/* OANDA */ TP/SL
{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 0.5,
  "take_profit_percent": 1.5
}

{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "sell",
  "symbol": "{{ticker}}",
  "stop_loss_percent": 0.5,
  "take_profit_percent": 1.5
}

/* OANDA */ TRAILING STOP LOSS

{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "buy",
  "symbol": "{{ticker}}",
  "useTrailingStop": true,
  "trailing_stop_pips": 30
}

{
  "secret": "Sparky_Bot_Secret_XYZ123",
  "exchange": "oanda",
  "action": "sell",
  "symbol": "{{ticker}}",
  "useTrailingStop": true,
  "trailing_stop_pips": 30
}



/* message to use during alert setup */
{{strategy.order.alert_message}}

