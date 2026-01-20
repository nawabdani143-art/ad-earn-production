import 'package:flutter/material.dart';
import 'dashboard/dashboard_screen.dart';
import 'services/auth_service.dart';
import 'package:firebase_core/firebase_core.dart';
import 'dashboard/dashboard_screen.dart';
import 'dashboard/referral_leaderboard.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  runApp(MyApp());
}

class MyApp extends StatelessWidget{
  @override
  Widget build(BuildContext context){
    return MaterialApp(
      title:"AdEarn",
      theme: ThemeData(primarySwatch: Colors.green),
      home: DashboardScreen(),
    );
  }
}
